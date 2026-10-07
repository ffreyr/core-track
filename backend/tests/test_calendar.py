"""Tests for the /api/calendar aggregation endpoint, including multi-day tasks."""

from fastapi.testclient import TestClient


def _days(body: dict) -> dict[str, dict]:
    """Index a calendar response's days by ISO date."""
    return {day["date"]: day for day in body["days"]}


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
    days = _days(body)

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

    assert body["totals"] == {
        "income_total": 300.0,
        "expense_total": 55.5,
        "pending_expense_total": 0.0,
        "net": 244.5,
        "task_count": 2,  # the 2026-10-20 task is outside the range
        "open_task_count": 1,
        "completed_task_count": 1,
    }


def test_multi_day_task_is_injected_into_every_covered_day(client: TestClient) -> None:
    trip = client.post(
        "/api/tasks", json={"title": "Trip", "due_date": "2026-10-05", "end_date": "2026-10-08"}
    ).json()
    assert trip["span_days"] == 4

    body = client.get("/api/calendar", params={"start": "2026-10-01", "end": "2026-10-10"}).json()
    days = _days(body)
    covered = [d for d, day in days.items() if any(t["title"] == "Trip" for t in day["tasks"])]
    assert covered == ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]
    # Counted per day in cells, but once in the range totals.
    assert days["2026-10-06"]["open_task_count"] == 1
    assert body["totals"]["task_count"] == 1


def test_multi_day_task_is_clipped_to_the_visible_range(client: TestClient) -> None:
    client.post("/api/tasks", json={"title": "Conference", "due_date": "2026-09-29", "end_date": "2026-10-02"})

    body = client.get("/api/calendar", params={"start": "2026-10-01", "end": "2026-10-07"}).json()
    covered = [d["date"] for d in body["days"] if d["tasks"]]
    assert covered == ["2026-10-01", "2026-10-02"]
    task = body["days"][0]["tasks"][0]
    # The task keeps its real dates so clients can show it continues from earlier.
    assert (task["due_date"], task["end_date"]) == ("2026-09-29", "2026-10-02")


def test_multi_day_tasks_come_first_in_a_stable_order(client: TestClient) -> None:
    client.post("/api/tasks", json={"title": "Urgent", "due_date": "2026-10-06", "priority": 3})
    client.post("/api/tasks", json={"title": "Short", "due_date": "2026-10-06", "end_date": "2026-10-07"})
    client.post("/api/tasks", json={"title": "Long", "due_date": "2026-10-05", "end_date": "2026-10-09"})
    client.post("/api/tasks", json={"title": "Same start, longer", "due_date": "2026-10-06", "end_date": "2026-10-08"})

    days = _days(client.get("/api/calendar", params={"start": "2026-10-05", "end": "2026-10-09"}).json())
    # Earliest start first, then longest span; single-day tasks after all multi-day ones.
    assert [t["title"] for t in days["2026-10-06"]["tasks"]] == ["Long", "Same start, longer", "Short", "Urgent"]
    assert [t["title"] for t in days["2026-10-07"]["tasks"]] == ["Long", "Same start, longer", "Short"]


def test_pending_expenses_are_reported_per_day(client: TestClient) -> None:
    client.post("/api/finance", json={"kind": "expense", "amount": 2500, "category": "Card", "occurred_on": "2026-10-14", "is_paid": False})
    client.post("/api/finance", json={"kind": "expense", "amount": 100, "category": "Food", "occurred_on": "2026-10-14"})

    body = client.get("/api/calendar", params={"start": "2026-10-14", "end": "2026-10-14"}).json()
    day = body["days"][0]
    assert day["expense_total"] == 2600
    assert day["pending_expense_total"] == 2500
    assert body["totals"]["pending_expense_total"] == 2500


def test_rejects_inverted_range(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"start": "2026-10-10", "end": "2026-10-01"})
    assert response.status_code == 422


def test_rejects_too_long_range(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"start": "2026-01-01", "end": "2028-01-01"})
    assert response.status_code == 422


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
