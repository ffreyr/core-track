"""Tests for the SQLite schema migration runner.

Each test builds its own temporary database file (independent of the shared
in-memory test database) so real upgrade paths can be exercised.
"""

import sqlite3
from contextlib import closing
from pathlib import Path

from sqlalchemy import text

from app.database import Base, build_engine
from app.migrations import LATEST_VERSION, run_migrations

#: The Phase 1 schema exactly as the original models created it (no
#: tasks.end_date, no financial_logs.is_paid, user_version never set).
PHASE_1_SCHEMA = """
CREATE TABLE tasks (
    id INTEGER NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    scope VARCHAR(16) NOT NULL,
    due_date DATE NOT NULL,
    is_completed BOOLEAN NOT NULL,
    completed_at DATETIME,
    priority INTEGER NOT NULL,
    color VARCHAR(7),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT ck_tasks_priority_range CHECK (priority BETWEEN 0 AND 3)
);
CREATE TABLE financial_logs (
    id INTEGER NOT NULL PRIMARY KEY,
    kind VARCHAR(16) NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL,
    category VARCHAR(60) NOT NULL,
    description TEXT,
    occurred_on DATE NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT ck_financial_logs_amount_positive CHECK (amount_cents > 0)
);
INSERT INTO tasks VALUES (1, 'Old task', NULL, 'daily', '2026-10-01', 0, NULL, 1, NULL,
                          '2026-10-01 10:00:00', '2026-10-01 10:00:00');
INSERT INTO financial_logs VALUES (1, 'expense', 12345, 'TRY', 'Rent', NULL, '2026-10-01',
                                   '2026-10-01 10:00:00', '2026-10-01 10:00:00');
"""


def _connect(db_path: Path) -> closing[sqlite3.Connection]:
    """Open a raw connection that is *closed* on exit.

    ``with sqlite3.connect(...)`` alone only commits; it never closes the
    connection, which Python 3.13+ reports as a ResourceWarning.
    """
    return closing(sqlite3.connect(db_path, autocommit=True))


def _create_all(engine) -> None:  # noqa: ANN001 - matches the runner's callback signature
    Base.metadata.create_all(bind=engine)


def _columns(db_path: Path, table: str) -> set[str]:
    with _connect(db_path) as conn:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _user_version(db_path: Path) -> int:
    with _connect(db_path) as conn:
        return conn.execute("PRAGMA user_version").fetchone()[0]


def test_fresh_database_is_created_at_latest_version(tmp_path: Path) -> None:
    db_path = tmp_path / "fresh.db"
    engine = build_engine(f"sqlite:///{db_path}")

    assert run_migrations(engine, _create_all, db_path) == []
    assert _user_version(db_path) == LATEST_VERSION
    assert "end_date" in _columns(db_path, "tasks")
    assert "is_paid" in _columns(db_path, "financial_logs")
    assert not (tmp_path / "backups").exists()  # nothing to back up
    engine.dispose()


def test_phase_1_database_is_upgraded_with_data_preserved(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.db"
    with _connect(db_path) as conn:
        conn.executescript(PHASE_1_SCHEMA)
    engine = build_engine(f"sqlite:///{db_path}")

    assert run_migrations(engine, _create_all, db_path) == [2]
    assert _user_version(db_path) == LATEST_VERSION

    with engine.connect() as conn:
        task = conn.execute(text("SELECT title, end_date FROM tasks")).one()
        log = conn.execute(text("SELECT amount_cents, is_paid FROM financial_logs")).one()
    assert tuple(task) == ("Old task", None)
    # Pre-existing entries were real transactions, so they become "paid".
    assert tuple(log) == (12345, 1)

    backups = list((tmp_path / "backups").glob("legacy-*-pre-v2.db"))
    assert len(backups) == 1
    assert "is_paid" not in _columns(backups[0], "financial_logs")  # snapshot of the old schema
    engine.dispose()


def test_running_twice_is_a_no_op(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.db"
    with _connect(db_path) as conn:
        conn.executescript(PHASE_1_SCHEMA)
    engine = build_engine(f"sqlite:///{db_path}")

    assert run_migrations(engine, _create_all, db_path) == [2]
    assert run_migrations(engine, _create_all, db_path) == []
    assert len(list((tmp_path / "backups").iterdir())) == 1
    engine.dispose()


def test_interrupted_migration_can_be_resumed(tmp_path: Path) -> None:
    """A column added before a crash must not make the re-run fail."""
    db_path = tmp_path / "partial.db"
    with _connect(db_path) as conn:
        conn.executescript(PHASE_1_SCHEMA)
        conn.execute("ALTER TABLE tasks ADD COLUMN end_date DATE")  # first step done, then "crash"
    engine = build_engine(f"sqlite:///{db_path}")

    assert run_migrations(engine, _create_all, db_path) == [2]
    assert "is_paid" in _columns(db_path, "financial_logs")
    engine.dispose()
