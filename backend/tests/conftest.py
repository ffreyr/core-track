"""Shared pytest fixtures.

The database URL is pointed at a shared in-memory SQLite database *before*
the application is imported, so the test-suite never touches the real
``data/core_track.db`` file. Each test gets freshly created, empty tables.
"""

import os

os.environ["CORE_TRACK_DATABASE_URL"] = "sqlite://"

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Yield a TestClient backed by an empty in-memory database.

    Tables are dropped and recreated around every test for full isolation.
    Using the client as a context manager runs the app's lifespan hook too.
    """
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)
