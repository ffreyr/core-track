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
