"""Database engine, session factory and FastAPI session dependency.

Core-Track uses SQLite through SQLAlchemy 2.x. This module owns:

* the declarative :class:`Base` every ORM model inherits from,
* the process-wide :data:`engine` and :data:`SessionLocal` factory,
* :func:`get_db`, the request-scoped session dependency used by routers,
* :func:`init_db`, which creates missing tables at startup.

SQLite-specific tuning (WAL journaling, foreign-key enforcement) is applied to
every new DB-API connection via a ``connect`` event listener.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import URL, create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base class shared by all ORM models."""


def _is_in_memory(url: URL) -> bool:
    """Return ``True`` when ``url`` points at an in-memory SQLite database."""
    return url.database in (None, "", ":memory:")


def _ensure_parent_directory(url: URL) -> None:
    """Create the directory that will hold the SQLite file, if it is missing.

    SQLite creates the database file on first connect but will not create
    intermediate directories, so a fresh checkout would otherwise fail with
    "unable to open database file".
    """
    if url.database:
        Path(url.database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


def _apply_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    """Configure each new SQLite connection.

    * ``foreign_keys=ON``   – SQLite ignores FK constraints unless asked.
    * ``journal_mode=WAL``  – readers no longer block the writer, which matters
      once the desktop app, phone and widget refresh concurrently.
    * ``synchronous=NORMAL`` – the recommended durability level for WAL mode;
      safe against application crashes, much faster than ``FULL``.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def build_engine(database_url: str) -> Engine:
    """Create a SQLAlchemy engine for ``database_url``.

    For SQLite the connection is opened with ``check_same_thread=False``
    because FastAPI may run a request's sync dependency and handler on
    different worker threads; each request still gets its own session.

    In-memory databases use :class:`~sqlalchemy.pool.StaticPool` so every
    session shares the *same* single connection — otherwise each new
    connection would see a brand-new, empty database.

    Args:
        database_url: Any SQLAlchemy URL string.

    Returns:
        A configured :class:`~sqlalchemy.engine.Engine`.
    """
    url = make_url(database_url)
    engine_kwargs: dict[str, Any] = {}

    if url.get_backend_name() == "sqlite":
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        if _is_in_memory(url):
            engine_kwargs["poolclass"] = StaticPool
        else:
            _ensure_parent_directory(url)

    engine = create_engine(url, **engine_kwargs)

    if url.get_backend_name() == "sqlite":
        event.listen(engine, "connect", _apply_sqlite_pragmas)

    return engine


#: Process-wide engine built from the configured database URL.
engine: Engine = build_engine(get_settings().database_url)

#: Session factory. ``expire_on_commit=False`` keeps loaded attributes usable
#: after ``commit()`` so handlers can serialise objects without a reload.
SessionLocal: sessionmaker[Session] = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


def get_db() -> Iterator[Session]:
    """FastAPI dependency that yields one database session per request.

    The session is always closed when the request finishes, even if the
    handler raised, returning its connection to the pool.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create any tables that do not exist yet.

    Importing :mod:`app.models` registers every model on ``Base.metadata``.
    ``create_all`` is idempotent: existing tables are left untouched, so this
    is safe to call on every startup. Schema *changes* to existing tables will
    need a migration tool (Alembic) once the data model stabilises.
    """
    from app import models  # noqa: F401  (import registers the ORM models)

    Base.metadata.create_all(bind=engine)
