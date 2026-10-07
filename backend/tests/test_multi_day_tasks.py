"""Tests for multi-day task creation, validation, moving, resizing and listing."""

from fastapi.testclient import TestClient


def _create(client: TestClient, **body: object) -> dict:
    """Create a task and return the response body."""
    response = client.post("/api/tasks", json={"title": "Trip", "due_date": "2026-10-05", **body})
    assert response.status_code == 201, response.text
    return response.json()


def test_single_day_task_has_no_end_date(client: TestClient) -> None:
    task = _create(client)
    assert task["end_date"] is None
    assert task["span_days"] == 1


def test_end_date_equal_to_due_date_is_normalised_to_single_day(client: TestClient) -> None:
    task = _create(client, end_date="2026-10-05")
    assert task["end_date"] is None
    assert task["span_days"] == 1


def test_create_validation(client: TestClient) -> None:
    before = client.post("/api/tasks", json={"title": "x", "due_date": "2026-10-05", "end_date": "2026-10-04"})
    assert before.status_code == 422
    too_long = client.post("/api/tasks", json={"title": "x", "due_date": "2026-01-01", "end_date": "2027-06-01"})
    assert too_long.status_code == 422


def test_moving_a_multi_day_task_keeps_its_length(client: TestClient) -> None:
    task = _create(client, end_date="2026-10-08")  # 4 days
    moved = client.patch(f"/api/tasks/{task['id']}", json={"due_date": "2026-10-12"}).json()
    assert (moved["due_date"], moved["end_date"], moved["span_days"]) == ("2026-10-12", "2026-10-15", 4)

    earlier = client.patch(f"/api/tasks/{task['id']}", json={"due_date": "2026-10-01"}).json()
    assert (earlier["due_date"], earlier["end_date"]) == ("2026-10-01", "2026-10-04")


def test_resizing_and_collapsing(client: TestClient) -> None:
    task = _create(client)
    longer = client.patch(f"/api/tasks/{task['id']}", json={"end_date": "2026-10-09"}).json()
    assert (longer["end_date"], longer["span_days"]) == ("2026-10-09", 5)

    single = client.patch(f"/api/tasks/{task['id']}", json={"end_date": None}).json()
    assert (single["end_date"], single["span_days"]) == (None, 1)

    explicit = client.patch(
        f"/api/tasks/{task['id']}", json={"due_date": "2026-11-01", "end_date": "2026-11-03"}
    ).json()
    assert (explicit["due_date"], explicit["end_date"]) == ("2026-11-01", "2026-11-03")


def test_invalid_update_is_rejected_and_leaves_task_untouched(client: TestClient) -> None:
    task = _create(client, end_date="2026-10-08")
    response = client.patch(f"/api/tasks/{task['id']}", json={"end_date": "2026-10-01"})
    assert response.status_code == 422
    assert "end_date" in response.json()["detail"]

    unchanged = client.get(f"/api/tasks/{task['id']}").json()
    assert (unchanged["due_date"], unchanged["end_date"]) == ("2026-10-05", "2026-10-08")


def test_list_uses_overlap_semantics(client: TestClient) -> None:
    _create(client, title="Spans months", due_date="2026-10-30", end_date="2026-11-02")
    _create(client, title="October only", due_date="2026-10-10")
    _create(client, title="November only", due_date="2026-11-10")

    november = client.get("/api/tasks", params={"start": "2026-11-01", "end": "2026-11-30"}).json()
    assert [t["title"] for t in november] == ["Spans months", "November only"]

    october = client.get("/api/tasks", params={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert [t["title"] for t in october] == ["October only", "Spans months"]
