"""Tests for the /api/calendar aggregation endpoint."""

from fastapi.testclient import TestClient


def test_every_day_present_even_when_empty(client: TestClient) -> None:
    body = client.get("/api/calendar", params={"start": "2026-10-01", "end": "2026-10-07"}).json()
    assert [d["date"] for d in body["days"]] == [f"2026-10-0{i}" for i in range(1, 8)]
    assert all(d["tasks"] == [] and d["finance"] == [] for d in body["days"])
    assert body["totals"]["task_count"] == 0
    assert body["totals"]["net"] == 0


def test_groups_tasks_and_finance_by_day(client: TestClient) -> None:
    t1 = client.post("/api/tasks", json={"title": "Gym", "due_date": "2026-10-02"}).json()
    client.post("/api/tasks", json={"title": "Plan Q4", "scope": "monthly", "due_date": "2026-10-02", "priority": 3})
    client.post("/api/tasks", json={"title": "Outside", "due_date": "2026-10-20"})
    client.post(f"/api/tasks/{t1['id']}/toggle")

    client.post("/api/finance", json={"kind": "income", "amount": 300, "category": "Freelance", "occurred_on": "2026-10-02"})
    client.post("/api/finance", json={"kind": "expense", "amount": 45.5, "category": "Food", "occurred_on": "2026-10-02"})
    client.post("/api/finance", json={"kind": "expense", "amount": 10, "category": "Coffee", "occurred_on": "2026-10-03"})

    body = client.get("/api/calendar", params={"start": "2026-10-01", "end": "2026-10-03"}).json()
    days = {d["date"]: d for d in body["days"]}

    oct2 = days["2026-10-02"]
    assert [t["title"] for t in oct2["tasks"]] == ["Plan Q4", "Gym"]  # higher priority first
    assert oct2["open_task_count"] == 1
    assert oct2["completed_task_count"] == 1
    assert len(oct2["finance"]) == 2
    assert oct2["income_total"] == 300
    assert oct2["expense_total"] == 45.5
    assert oct2["net"] == 254.5

    assert days["2026-10-03"]["net"] == -10
    assert days["2026-10-01"]["tasks"] == []

    totals = body["totals"]
    assert totals == {
        "income_total": 300.0,
        "expense_total": 55.5,
        "net": 244.5,
        "task_count": 2,  # the 2026-10-20 task is outside the range
        "open_task_count": 1,
        "completed_task_count": 1,
    }


def test_rejects_inverted_range(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"start": "2026-10-10", "end": "2026-10-01"})
    assert response.status_code == 422


def test_rejects_too_long_range(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"start": "2026-01-01", "end": "2028-01-01"})
    assert response.status_code == 422


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
