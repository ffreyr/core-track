"""Application configuration.

All runtime settings live in a single :class:`Settings` object populated from
(in order of precedence) real environment variables, an optional
``backend/.env`` file, and the defaults declared below. Every variable uses the
``CORE_TRACK_`` prefix, e.g. ``CORE_TRACK_DATABASE_URL``.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

#: Absolute path of the ``backend/`` directory, resolved from this file so the
#: defaults work no matter which directory uvicorn is launched from.
BACKEND_DIR: Path = Path(__file__).resolve().parent.parent

#: Default on-disk location of the SQLite database file.
DEFAULT_DB_PATH: Path = BACKEND_DIR / "data" / "core_track.db"


class Settings(BaseSettings):
    """Typed settings for the Core-Track API.

    Attributes:
        app_name: Human-readable title shown in the OpenAPI docs.
        app_version: Semantic version reported by ``/api/health``.
        api_prefix: Path prefix under which every router is mounted.
        database_url: SQLAlchemy connection URL. ``sqlite://`` (no path)
            selects a shared in-memory database, which the test-suite uses.
        cors_origins: Browser origins allowed to call the API. Native mobile
            and widget clients are not subject to CORS; this list exists for
            the Tauri webview and local browser development.
        max_calendar_span_days: Upper bound on the date range the calendar
            aggregation endpoint will build, protecting against accidental
            multi-year requests.
    """

    model_config = SettingsConfigDict(
        env_prefix="CORE_TRACK_",
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Core-Track API"
    app_version: str = "0.2.8"
    api_prefix: str = "/api"
    database_url: str = f"sqlite:///{DEFAULT_DB_PATH}"
    cors_origins: list[str] = [
        "http://localhost:1420",  # Tauri dev server (Vite default for Tauri templates)
        "http://127.0.0.1:1420",
        "http://localhost:5173",  # Plain Vite dev server, handy for browser-only UI work
        "tauri://localhost",  # Packaged Tauri app on macOS
        "http://tauri.localhost",  # Packaged Tauri app on Windows (kept for completeness)
    ]
    max_calendar_span_days: int = 366


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide :class:`Settings` instance.

    The result is cached so the environment and ``.env`` file are read exactly
    once; every module that needs configuration shares the same object.
    """
    return Settings()
