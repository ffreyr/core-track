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
