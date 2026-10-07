"""Lightweight, versioned schema migrations for SQLite.

``Base.metadata.create_all`` creates missing *tables* but never alters
existing ones, so adding a column to a model would leave an existing
database without it. This module upgrades existing databases in place.

How it works:

* The schema version lives in SQLite's built-in ``PRAGMA user_version``
  (an integer stored in the database header; ``0`` on any new file).
* Version 1 is the original Phase 1 schema. A database whose tables exist
  but whose ``user_version`` is ``0`` was created by Phase 1 code (which did
  not stamp a version) and is treated as version 1.
* A brand-new, empty database is created directly at the latest schema by
  ``create_all`` and stamped with :data:`LATEST_VERSION`; no migrations run.
* Before upgrading an existing *file* database, a consistent backup is
  written to ``data/backups/`` using SQLite's online backup API (safe with
  WAL mode and a running server).

Every migration step is idempotent (it checks before altering), so a run
that is interrupted part-way can simply be repeated on the next startup.

Why not Alembic? For a single-user SQLite app whose changes are additive,
a ~100-line runner with no extra dependency is easier to reason about.
Switch to Alembic if migrations ever need data transforms or downgrades.
"""

import logging
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger("core_track.migrations")


@dataclass(frozen=True)
class Migration:
    """One schema upgrade step.

    Attributes:
        version: Schema version the database is at *after* this step.
        description: Human-readable summary, logged when applied.
        apply: Function performing the DDL on an open connection.
    """

    version: int
    description: str
    apply: Callable[[Connection], None]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _column_names(conn: Connection, table: str) -> set[str]:
    """Return the column names of ``table`` (empty if the table is missing)."""
    rows = conn.exec_driver_sql(f'PRAGMA table_info("{table}")').fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(conn: Connection, table: str, column: str, ddl: str) -> None:
    """Run ``ALTER TABLE ... ADD COLUMN`` only if the column does not exist yet.

    Args:
        conn: Open connection.
        table: Target table.
        column: Column name to add.
        ddl: Column type and constraints, e.g. ``"BOOLEAN NOT NULL DEFAULT 1"``.
            SQLite only allows ``NOT NULL`` on added columns that have a default.
    """
    if column not in _column_names(conn, table):
        conn.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}')


# ---------------------------------------------------------------------------
# Migration steps
# ---------------------------------------------------------------------------


def _v2_multi_day_tasks_and_pending_payments(conn: Connection) -> None:
    """Phase 2.5: multi-day tasks and planned (unpaid) financial entries.

    * ``tasks.end_date`` – nullable; ``NULL`` means a single-day task.
    * ``financial_logs.is_paid`` – existing rows were real, completed
      transactions, so they default to paid (``1``).
    """
    _add_column_if_missing(conn, "tasks", "end_date", "DATE")
    conn.exec_driver_sql('CREATE INDEX IF NOT EXISTS "ix_tasks_end_date" ON "tasks" ("end_date")')
    _add_column_if_missing(conn, "financial_logs", "is_paid", "BOOLEAN NOT NULL DEFAULT 1")


#: Ordered list of all migrations. Append new steps; never edit applied ones.
MIGRATIONS: tuple[Migration, ...] = (
    Migration(2, "add tasks.end_date and financial_logs.is_paid", _v2_multi_day_tasks_and_pending_payments),
)

#: Schema version produced by the current models.
LATEST_VERSION: int = MIGRATIONS[-1].version if MIGRATIONS else 1

#: Version assumed for pre-existing databases that were never stamped.
BASELINE_VERSION = 1


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _get_user_version(conn: Connection) -> int:
    """Read ``PRAGMA user_version``."""
    return int(conn.exec_driver_sql("PRAGMA user_version").scalar() or 0)


def _set_user_version(conn: Connection, version: int) -> None:
    """Write ``PRAGMA user_version`` (PRAGMAs cannot take bound parameters)."""
    conn.exec_driver_sql(f"PRAGMA user_version = {int(version)}")


def backup_sqlite_file(db_path: Path, backup_dir: Path, label: str) -> Path:
    """Write a consistent copy of a SQLite database file.

    Uses ``sqlite3.Connection.backup`` rather than a file copy, so the
    snapshot is transactionally consistent even with WAL files present and
    another process (e.g. the running server) holding the database open.

    Args:
        db_path: Path of the live database file.
        backup_dir: Directory for backups (created if missing).
        label: Short tag included in the file name, e.g. ``"pre-v2"``.

    Returns:
        Path of the backup file.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = backup_dir / f"{db_path.stem}-{stamp}-{label}.db"
    source = sqlite3.connect(db_path)
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    return target


def run_migrations(engine: Engine, metadata_create_all: Callable[[Engine], None], db_path: Path | None) -> list[int]:
    """Bring the database schema to :data:`LATEST_VERSION`.

    Args:
        engine: Engine bound to the target database.
        metadata_create_all: Callback creating any missing tables (normally
            ``Base.metadata.create_all``); passed in to avoid an import cycle.
        db_path: Filesystem path of the database, or ``None`` for in-memory
            databases (which are never backed up).

    Returns:
        Versions of the migrations that were applied (empty if none).
    """
    with engine.connect() as conn:
        has_tables = bool(inspect(conn).get_table_names())
        stored = _get_user_version(conn)

    # Fresh database: build the latest schema directly and stamp it.
    if not has_tables:
        metadata_create_all(engine)
        with engine.begin() as conn:
            _set_user_version(conn, LATEST_VERSION)
        logger.info("Created new database at schema v%s", LATEST_VERSION)
        return []

    current = stored if stored > 0 else BASELINE_VERSION

    pending = [migration for migration in MIGRATIONS if migration.version > current]
    if pending and db_path is not None and db_path.exists():
        backup = backup_sqlite_file(db_path, db_path.parent / "backups", f"pre-v{pending[-1].version}")
        logger.info("Backed up database to %s before migrating", backup)

    applied: list[int] = []
    for migration in pending:
        with engine.begin() as conn:
            migration.apply(conn)
            _set_user_version(conn, migration.version)
        applied.append(migration.version)
        logger.info("Applied migration v%s: %s", migration.version, migration.description)

    # Create any tables introduced since the database was made (none yet, but
    # this keeps new tables working without a dedicated migration step).
    metadata_create_all(engine)

    # An unstamped baseline database with nothing pending still gets a version
    # recorded, so the next startup does not have to infer it again.
    if stored == 0 and not pending:
        with engine.begin() as conn:
            _set_user_version(conn, current)

    return applied
