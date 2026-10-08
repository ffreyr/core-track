"""FastAPI application entry point.

Run locally (from ``backend/``)::

    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

``--host 0.0.0.0`` exposes the API on the local network so the phone can reach
it at ``http://<mac-lan-ip>:8000``. Interactive docs are served at ``/docs``.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app import schemas
from app.config import get_settings
from app.database import init_db
from app.models import utcnow
from app.routers import calendar, finance, study, tasks


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Run startup work before the server accepts requests.

    Creates any missing tables so a fresh checkout works with zero manual
    database setup.
    """
    init_db()
    yield


def create_app() -> FastAPI:
    """Build and configure the FastAPI application.

    Wiring:
        * CORS for the Tauri webview / browser dev server (native mobile and
          widget clients are not subject to CORS).
        * Resource routers mounted under ``settings.api_prefix``.
        * ``GET {prefix}/health`` for connectivity checks from every client.
        * ``GET /`` redirects to the interactive API docs.
    """
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Single-user tasks, finance and calendar API for Core-Track.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # No cookies or auth headers in this app.
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(tasks.router, prefix=settings.api_prefix)
    app.include_router(finance.router, prefix=settings.api_prefix)
    app.include_router(calendar.router, prefix=settings.api_prefix)
    app.include_router(study.router, prefix=settings.api_prefix)

    @app.get(f"{settings.api_prefix}/health", response_model=schemas.HealthResponse, tags=["meta"])
    def health() -> schemas.HealthResponse:
        """Report that the API is up, plus its version and current server time."""
        return schemas.HealthResponse(
            status="ok",
            app=settings.app_name,
            version=settings.app_version,
            server_time=utcnow(),
        )

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        """Send bare-root visits to the Swagger UI."""
        return RedirectResponse(url="/docs")

    return app


#: ASGI application instance used by uvicorn (``app.main:app``).
app = create_app()
