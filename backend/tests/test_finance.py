"""Tests for the /api/finance endpoints."""

from fastapi.testclient import TestClient


def _create(client: TestClient, **overrides: object) -> dict:
    """Record a financial log with sensible defaults and return the body."""
    body = {
        "kind": "expense",
        "amount": "100.00",
        "category": "Groceries",
        "occurred_on": "2026-10-03",
        **overrides,
    }
    response = client.post("/api/finance", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_and_get(client: TestClient) -> None:
    log = _create(client, amount=12.5, currency="USD")
    assert log["amount"] == 12.5
    assert log["currency"] == "USD"
    assert log["kind"] == "expense"
    assert client.get(f"/api/finance/{log['id']}").json() == log


def test_default_currency(client: TestClient) -> None:
    assert _create(client)["currency"] == "TRY"


def test_amount_validation(client: TestClient) -> None:
    base = {"kind": "income", "category": "Salary", "occurred_on": "2026-10-01"}
    assert client.post("/api/finance", json={**base, "amount": 0}).status_code == 422
    assert client.post("/api/finance", json={**base, "amount": -5}).status_code == 422
    assert client.post("/api/finance", json={**base, "amount": "1.005"}).status_code == 422
    assert client.post("/api/finance", json={**base, "amount": 1, "currency": "usd"}).status_code == 422


def test_list_filters(client: TestClient) -> None:
    _create(client, kind="income", category="Salary", amount=5000, occurred_on="2026-10-01")
    _create(client, category="Rent", amount=1500, occurred_on="2026-10-02")
    _create(client, category="Rent", amount=1500, occurred_on="2026-11-02")

    income = client.get("/api/finance", params={"kind": "income"}).json()
    assert [log["category"] for log in income] == ["Salary"]

    rent_oct = client.get(
        "/api/finance", params={"category": "Rent", "start": "2026-10-01", "end": "2026-10-31"}
    ).json()
    assert len(rent_oct) == 1


def test_patch_and_delete(client: TestClient) -> None:
    log = _create(client)
    updated = client.patch(f"/api/finance/{log['id']}", json={"amount": "99.99", "category": "Food"}).json()
    assert updated["amount"] == 99.99
    assert updated["category"] == "Food"
    assert client.patch(f"/api/finance/{log['id']}", json={"amount": None}).status_code == 422

    assert client.delete(f"/api/finance/{log['id']}").status_code == 204
    assert client.get(f"/api/finance/{log['id']}").status_code == 404


def test_monthly_summary(client: TestClient) -> None:
    _create(client, kind="income", category="Salary", amount="5000", occurred_on="2026-10-01")
    _create(client, kind="expense", category="Rent", amount="1500", occurred_on="2026-10-02")
    _create(client, kind="expense", category="Groceries", amount="0.10", occurred_on="2026-10-02")
    _create(client, kind="expense", category="Groceries", amount="0.20", occurred_on="2026-10-02")
    _create(client, kind="expense", category="Rent", amount="1500", occurred_on="2026-11-02")  # other month

    summary = client.get("/api/finance/summary", params={"year": 2026, "month": 10}).json()
    assert summary["income_total"] == 5000
    assert summary["expense_total"] == 1500.3  # exact cents, no float drift
    assert summary["net"] == 3499.7
    assert summary["entry_count"] == 4

    by_cat = {(c["category"], c["kind"]): c for c in summary["by_category"]}
    assert by_cat[("Groceries", "expense")]["total"] == 0.3
    assert by_cat[("Groceries", "expense")]["count"] == 2

    assert len(summary["daily"]) == 31
    day2 = next(d for d in summary["daily"] if d["date"] == "2026-10-02")
    assert day2 == {"date": "2026-10-02", "income": 0.0, "expense": 1500.3, "net": -1500.3}


def test_summary_covers_leap_february(client: TestClient) -> None:
    summary = client.get("/api/finance/summary", params={"year": 2028, "month": 2}).json()
    assert len(summary["daily"]) == 29
    assert summary["net"] == 0


def test_summary_validates_month(client: TestClient) -> None:
    assert client.get("/api/finance/summary", params={"year": 2026, "month": 13}).status_code == 422
