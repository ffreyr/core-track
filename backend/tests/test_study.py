"""Tests for the /api/study timer endpoints.

A controllable clock replaces ``app.crud.utcnow`` so durations, the 24-hour
cap and local-day bucketing can be asserted exactly.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import crud


class FakeClock:
    """Settable replacement for ``utcnow`` used by the study logic."""

    def __init__(self) -> None:
        self.now = datetime(2026, 10, 8, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    fake = FakeClock()
    monkeypatch.setattr(crud, "utcnow", fake)
    return fake


def test_idle_timer_has_no_active_session(client: TestClient) -> None:
    assert client.get("/api/study/active").json() is None
    assert client.post("/api/study/stop").status_code == 404


def test_start_and_stop_records_duration(client: TestClient, clock: FakeClock) -> None:
    started = client.post("/api/study/start", json={"subject": "Mathematics", "planned_minutes": 25})
    assert started.status_code == 201
    body = started.json()
    assert (body["is_running"], body["duration_seconds"], body["planned_minutes"]) == (True, None, 25)
    assert client.get("/api/study/active").json()["id"] == body["id"]

    clock.advance(minutes=25, seconds=30)
    stopped = client.post("/api/study/stop").json()
    assert (stopped["is_running"], stopped["duration_seconds"]) == (False, 25 * 60 + 30)
    assert client.get("/api/study/active").json() is None


def test_starting_again_stops_the_running_session(client: TestClient, clock: FakeClock) -> None:
    first = client.post("/api/study/start", json={"subject": "Physics"}).json()
    clock.advance(minutes=10)
    second = client.post("/api/study/start", json={"subject": "Chemistry"}).json()

    sessions = {s["id"]: s for s in client.get("/api/study/sessions").json()}
    assert sessions[first["id"]]["duration_seconds"] == 600
    assert sessions[second["id"]]["is_running"] is True
    assert sum(1 for s in sessions.values() if s["is_running"]) == 1


def test_forgotten_timer_is_capped_at_24_hours(client: TestClient, clock: FakeClock) -> None:
    client.post("/api/study/start", json={"subject": "Reading"})
    clock.advance(days=3)
    stopped = client.post("/api/study/stop").json()
    assert stopped["duration_seconds"] == 24 * 3600


def test_session_can_link_to_a_task_and_survives_task_deletion(client: TestClient, clock: FakeClock) -> None:
    task = client.post("/api/tasks", json={"title": "Exam prep", "due_date": "2026-10-08"}).json()
    session = client.post("/api/study/start", json={"subject": "Exam", "task_id": task["id"]}).json()
    assert (session["task_id"], session["task_title"]) == (task["id"], "Exam prep")
    clock.advance(minutes=5)
    client.post("/api/study/stop")

    assert client.post("/api/study/start", json={"task_id": 9999}).status_code == 422

    client.delete(f"/api/tasks/{task['id']}")
    remaining = client.get("/api/study/sessions").json()
    assert len(remaining) == 1
    assert (remaining[0]["task_id"], remaining[0]["task_title"]) == (None, None)


def test_manual_session_validation_and_edit(client: TestClient, clock: FakeClock) -> None:
    base = {"subject": "History", "started_at": "2026-10-07T14:00:00+03:00"}
    created = client.post("/api/study/sessions", json={**base, "ended_at": "2026-10-07T15:30:00+03:00"})
    assert created.status_code == 201
    assert created.json()["duration_seconds"] == 90 * 60

    assert client.post("/api/study/sessions", json={**base, "ended_at": "2026-10-07T13:00:00+03:00"}).status_code == 422
    assert client.post("/api/study/sessions", json={**base, "ended_at": "2026-10-09T15:00:00+03:00"}).status_code == 422
    # Naive timestamps (no offset) are rejected: they would be ambiguous.
    naive = {"subject": "X", "started_at": "2026-10-07T14:00:00", "ended_at": "2026-10-07T15:00:00"}
    assert client.post("/api/study/sessions", json=naive).status_code == 422

    session_id = created.json()["id"]
    edited = client.patch(f"/api/study/sessions/{session_id}", json={"ended_at": "2026-10-07T14:45:00+03:00"})
    assert edited.json()["duration_seconds"] == 45 * 60
    bad = client.patch(f"/api/study/sessions/{session_id}", json={"ended_at": "2026-10-07T13:00:00+03:00"})
    assert bad.status_code == 422
    assert client.patch(f"/api/study/sessions/{session_id}", json={"ended_at": None}).status_code == 422

    assert client.delete(f"/api/study/sessions/{session_id}").status_code == 204
    assert client.get("/api/study/sessions").json() == []


def test_summary_buckets_by_local_day_and_subject(client: TestClient, clock: FakeClock) -> None:
    def log(subject: str, start: str, end: str) -> None:
        response = client.post("/api/study/sessions", json={"subject": subject, "started_at": start, "ended_at": end})
        assert response.status_code == 201

    # 23:30 Istanbul time on Oct 7 is 20:30 UTC: it belongs to Oct 7 locally.
    log("Mathematics", "2026-10-07T23:30:00+03:00", "2026-10-08T00:30:00+03:00")
    # 01:00 Istanbul on Oct 8 is still Oct 7 in UTC, but Oct 8 locally.
    log("Mathematics", "2026-10-08T01:00:00+03:00", "2026-10-08T01:30:00+03:00")
    log("Physics", "2026-10-08T10:00:00+03:00", "2026-10-08T10:20:00+03:00")
    client.post("/api/study/start", json={"subject": "Running now"})  # excluded from totals

    summary = client.get(
        "/api/study/summary", params={"start": "2026-10-07", "end": "2026-10-09", "tz": "Europe/Istanbul"}
    ).json()
    days = {d["date"]: d["seconds"] for d in summary["days"]}
    assert days == {"2026-10-07": 3600, "2026-10-08": 1800 + 1200, "2026-10-09": 0}
    assert summary["total_seconds"] == 6600
    assert summary["session_count"] == 3
    assert [(s["subject"], s["seconds"]) for s in summary["by_subject"]] == [("Mathematics", 5400), ("Physics", 1200)]
    assert summary["active"]["subject"] == "Running now"

    # In UTC the 01:00 Istanbul session falls on Oct 7 instead.
    utc = client.get("/api/study/summary", params={"start": "2026-10-07", "end": "2026-10-08", "tz": "UTC"}).json()
    assert {d["date"]: d["seconds"] for d in utc["days"]} == {"2026-10-07": 5400, "2026-10-08": 1200}


def test_summary_validation(client: TestClient) -> None:
    bad_tz = client.get("/api/study/summary", params={"start": "2026-10-01", "end": "2026-10-07", "tz": "Mars/Base"})
    assert bad_tz.status_code == 422
    inverted = client.get("/api/study/summary", params={"start": "2026-10-07", "end": "2026-10-01"})
    assert inverted.status_code == 422
    too_long = client.get("/api/study/summary", params={"start": "2026-01-01", "end": "2027-06-01"})
    assert too_long.status_code == 422
