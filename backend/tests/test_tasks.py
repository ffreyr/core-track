"""Tests for the /api/tasks endpoints."""

from fastapi.testclient import TestClient


def _create(client: TestClient, **overrides: object) -> dict:
    """Create a task with sensible defaults and return the response body."""
    body = {"title": "Pay rent", "scope": "monthly", "due_date": "2026-10-01", **overrides}
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_and_get_task(client: TestClient) -> None:
    task = _create(client, title="  Pay rent  ", priority=3, color="#FF8800")
    assert task["title"] == "Pay rent"  # whitespace trimmed
    assert task["scope"] == "monthly"
    assert task["priority"] == 3
    assert task["is_completed"] is False
    assert task["completed_at"] is None
    assert task["created_at"].endswith("Z") or task["created_at"].endswith("+00:00")

    fetched = client.get(f"/api/tasks/{task['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == task


def test_list_filters(client: TestClient) -> None:
    _create(client, title="A", scope="daily", due_date="2026-10-05")
    b = _create(client, title="B", scope="weekly", due_date="2026-10-06")
    _create(client, title="C", scope="daily", due_date="2026-11-01")
    client.post(f"/api/tasks/{b['id']}/toggle")

    daily = client.get("/api/tasks", params={"scope": "daily"}).json()
    assert [t["title"] for t in daily] == ["A", "C"]

    october = client.get("/api/tasks", params={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert [t["title"] for t in october] == ["A", "B"]

    done = client.get("/api/tasks", params={"completed": True}).json()
    assert [t["title"] for t in done] == ["B"]


def test_toggle_sets_and_clears_completed_at(client: TestClient) -> None:
    task = _create(client)

    done = client.post(f"/api/tasks/{task['id']}/toggle").json()
    assert done["is_completed"] is True
    assert done["completed_at"] is not None

    reopened = client.post(f"/api/tasks/{task['id']}/toggle").json()
    assert reopened["is_completed"] is False
    assert reopened["completed_at"] is None


def test_patch_updates_only_sent_fields(client: TestClient) -> None:
    task = _create(client, description="keep me")
    response = client.patch(f"/api/tasks/{task['id']}", json={"title": "Pay rent (Oct)", "is_completed": True})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Pay rent (Oct)"
    assert body["description"] == "keep me"
    assert body["is_completed"] is True
    assert body["completed_at"] is not None


def test_patch_rejects_null_for_required_field(client: TestClient) -> None:
    task = _create(client)
    response = client.patch(f"/api/tasks/{task['id']}", json={"title": None})
    assert response.status_code == 422


def test_patch_allows_clearing_optional_field(client: TestClient) -> None:
    task = _create(client, color="#123456")
    body = client.patch(f"/api/tasks/{task['id']}", json={"color": None}).json()
    assert body["color"] is None


def test_validation_errors(client: TestClient) -> None:
    base = {"title": "x", "due_date": "2026-10-01"}
    assert client.post("/api/tasks", json={**base, "color": "red"}).status_code == 422
    assert client.post("/api/tasks", json={**base, "priority": 7}).status_code == 422
    assert client.post("/api/tasks", json={**base, "scope": "hourly"}).status_code == 422
    assert client.post("/api/tasks", json={**base, "title": "   "}).status_code == 422
    assert client.post("/api/tasks", json={**base, "unknown": 1}).status_code == 422


def test_delete_then_404(client: TestClient) -> None:
    task = _create(client)
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 404


# ---------------------------------------------------------------------------
# Workflow status (todo / in_progress / done)
# ---------------------------------------------------------------------------


def test_new_tasks_default_to_todo_and_can_start_in_progress(client: TestClient) -> None:
    assert _create(client)["status"] == "todo"
    started = _create(client, title="Write report", status="in_progress")
    assert (started["status"], started["is_completed"], started["completed_at"]) == ("in_progress", False, None)
    done = _create(client, title="Already done", status="done")
    assert (done["status"], done["is_completed"]) == ("done", True)
    assert done["completed_at"] is not None


def test_status_transitions_keep_derived_fields_consistent(client: TestClient) -> None:
    task = _create(client)
    url = f"/api/tasks/{task['id']}"

    started = client.patch(url, json={"status": "in_progress"}).json()
    assert (started["status"], started["is_completed"], started["completed_at"]) == ("in_progress", False, None)

    finished = client.patch(url, json={"status": "done"}).json()
    assert (finished["status"], finished["is_completed"]) == ("done", True)
    assert finished["completed_at"] is not None

    reopened = client.patch(url, json={"status": "in_progress"}).json()
    assert (reopened["is_completed"], reopened["completed_at"]) == (False, None)

    assert client.patch(url, json={"status": "paused"}).status_code == 422
    assert client.patch(url, json={"status": None}).status_code == 422


def test_toggle_completes_in_progress_and_reopens_to_todo(client: TestClient) -> None:
    task = _create(client, status="in_progress")
    toggled = client.post(f"/api/tasks/{task['id']}/toggle").json()
    assert toggled["status"] == "done"
    back = client.post(f"/api/tasks/{task['id']}/toggle").json()
    assert (back["status"], back["is_completed"], back["completed_at"]) == ("todo", False, None)


def test_legacy_is_completed_maps_onto_status(client: TestClient) -> None:
    task = _create(client, status="in_progress")
    url = f"/api/tasks/{task['id']}"
    # Un-completing a task that is merely in progress leaves it in progress.
    assert client.patch(url, json={"is_completed": False}).json()["status"] == "in_progress"
    assert client.patch(url, json={"is_completed": True}).json()["status"] == "done"
    assert client.patch(url, json={"is_completed": False}).json()["status"] == "todo"
    # When both are sent, status wins.
    both = client.patch(url, json={"is_completed": True, "status": "in_progress"}).json()
    assert (both["status"], both["is_completed"]) == ("in_progress", False)


def test_list_filters_by_status(client: TestClient) -> None:
    _create(client, title="A")
    _create(client, title="B", status="in_progress")
    _create(client, title="C", status="done")
    in_progress = client.get("/api/tasks", params={"status": "in_progress"}).json()
    assert [t["title"] for t in in_progress] == ["B"]
    open_tasks = client.get("/api/tasks", params={"completed": False}).json()
    assert sorted(t["title"] for t in open_tasks) == ["A", "B"]


# ---------------------------------------------------------------------------
# Start / end times (HH:MM, 24-hour)
# ---------------------------------------------------------------------------


def test_tasks_are_all_day_by_default(client: TestClient) -> None:
    task = _create(client)
    assert (task["due_time"], task["end_time"]) == (None, None)


def test_create_timed_task(client: TestClient) -> None:
    task = _create(client, due_time="14:30", end_time="16:00")
    assert (task["due_time"], task["end_time"]) == ("14:30", "16:00")
    start_only = _create(client, title="Call", due_time="09:05")
    assert (start_only["due_time"], start_only["end_time"]) == ("09:05", None)
    # Equal start and end is allowed (a point-in-time reminder).
    same = _create(client, title="Pill", due_time="08:00", end_time="08:00")
    assert same["end_time"] == "08:00"


def test_time_format_and_order_validation(client: TestClient) -> None:
    base = {"title": "x", "due_date": "2026-10-01"}
    for bad in ["9:30", "24:00", "12:60", "1430", "2:30 PM", ""]:
        assert client.post("/api/tasks", json={**base, "due_time": bad}).status_code == 422, bad
    # end_time without due_time.
    assert client.post("/api/tasks", json={**base, "end_time": "10:00"}).status_code == 422
    # Single-day: end before start is rejected.
    assert client.post("/api/tasks", json={**base, "due_time": "16:00", "end_time": "14:00"}).status_code == 422
    # Multi-day: end time belongs to the last day, so it may be "earlier".
    multi = client.post(
        "/api/tasks",
        json={**base, "end_date": "2026-10-03", "due_time": "18:00", "end_time": "09:00"},
    )
    assert multi.status_code == 201


def test_update_times_and_clear_to_all_day(client: TestClient) -> None:
    task = _create(client)
    url = f"/api/tasks/{task['id']}"

    timed = client.patch(url, json={"due_time": "10:00", "end_time": "11:30"}).json()
    assert (timed["due_time"], timed["end_time"]) == ("10:00", "11:30")

    # Moving the date keeps the times.
    moved = client.patch(url, json={"due_date": "2026-10-05"}).json()
    assert (moved["due_date"], moved["due_time"], moved["end_time"]) == ("2026-10-05", "10:00", "11:30")

    # A new start after the existing end is rejected and nothing changes.
    rejected = client.patch(url, json={"due_time": "12:00"})
    assert rejected.status_code == 422
    assert client.get(url).json()["due_time"] == "10:00"

    # Clearing the start time makes the task all-day (end time cleared too).
    all_day = client.patch(url, json={"due_time": None}).json()
    assert (all_day["due_time"], all_day["end_time"]) == (None, None)

    # end_time alone on an all-day task is rejected.
    assert client.patch(url, json={"end_time": "09:00"}).status_code == 422


def test_collapsing_multi_day_validates_times(client: TestClient) -> None:
    task = _create(client, end_date="2026-10-03", due_time="18:00", end_time="09:00")
    response = client.patch(f"/api/tasks/{task['id']}", json={"end_date": None})
    assert response.status_code == 422
    assert "end_time" in response.json()["detail"]


def test_list_orders_multi_day_then_all_day_then_by_time(client: TestClient) -> None:
    day = {"due_date": "2026-10-08"}
    _create(client, title="Late", due_time="18:00", **day)
    _create(client, title="Early", due_time="07:30", **day)
    _create(client, title="All-day low", priority=0, **day)
    _create(client, title="All-day high", priority=3, **day)
    _create(client, title="Trip", end_date="2026-10-10", **day)
    _create(client, title="Noon", due_time="12:00", **day)

    titles = [t["title"] for t in client.get("/api/tasks", params={"start": "2026-10-08", "end": "2026-10-08"}).json()]
    assert titles == ["Trip", "All-day high", "All-day low", "Early", "Noon", "Late"]
