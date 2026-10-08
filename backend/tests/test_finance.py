"""Tests for the /api/finance endpoints, including paid/pending cash flow."""

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


def test_defaults_currency_and_paid(client: TestClient) -> None:
    log = _create(client)
    assert log["currency"] == "TRY"
    assert log["is_paid"] is True


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
    _create(client, category="Card", amount=800, occurred_on="2026-10-14", is_paid=False)

    income = client.get("/api/finance", params={"kind": "income"}).json()
    assert [log["category"] for log in income] == ["Salary"]

    rent_oct = client.get(
        "/api/finance", params={"category": "Rent", "start": "2026-10-01", "end": "2026-10-31"}
    ).json()
    assert len(rent_oct) == 1

    pending = client.get("/api/finance", params={"is_paid": False}).json()
    assert [log["category"] for log in pending] == ["Card"]


def test_patch_and_delete(client: TestClient) -> None:
    log = _create(client)
    updated = client.patch(f"/api/finance/{log['id']}", json={"amount": "99.99", "category": "Food"}).json()
    assert updated["amount"] == 99.99
    assert updated["category"] == "Food"
    assert client.patch(f"/api/finance/{log['id']}", json={"amount": None}).status_code == 422
    assert client.patch(f"/api/finance/{log['id']}", json={"is_paid": None}).status_code == 422

    assert client.delete(f"/api/finance/{log['id']}").status_code == 204
    assert client.get(f"/api/finance/{log['id']}").status_code == 404


def test_toggle_paid(client: TestClient) -> None:
    log = _create(client, is_paid=False)
    assert log["is_paid"] is False

    paid = client.post(f"/api/finance/{log['id']}/toggle-paid").json()
    assert paid["is_paid"] is True
    reverted = client.post(f"/api/finance/{log['id']}/toggle-paid").json()
    assert reverted["is_paid"] is False

    assert client.patch(f"/api/finance/{log['id']}", json={"is_paid": True}).json()["is_paid"] is True
    assert client.post("/api/finance/9999/toggle-paid").status_code == 404


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
    # Income categories are listed before expense categories.
    assert summary["by_category"][0]["kind"] == "income"

    assert len(summary["daily"]) == 31
    day2 = next(d for d in summary["daily"] if d["date"] == "2026-10-02")
    assert day2 == {
        "date": "2026-10-02",
        "income": 0.0,
        "expense": 1500.3,
        "net": -1500.3,
        "income_pending": 0.0,
        "expense_pending": 0.0,
    }


def test_cash_flow_summary_with_pending_entries(client: TestClient) -> None:
    """Expected income, paid vs pending expenses and the remaining budget."""
    _create(client, kind="income", category="Salary", amount="40000", occurred_on="2026-10-01")
    _create(client, kind="income", category="Freelance", amount="5000", occurred_on="2026-10-25", is_paid=False)
    _create(client, kind="expense", category="Rent", amount="15000", occurred_on="2026-10-01")
    _create(client, kind="expense", category="Credit card", amount="2500", occurred_on="2026-10-14", is_paid=False)
    _create(client, kind="expense", category="Credit card", amount="1000", occurred_on="2026-10-05")
    _create(client, kind="expense", category="Internet", amount="499.90", occurred_on="2026-10-20", is_paid=False)

    summary = client.get("/api/finance/summary", params={"year": 2026, "month": 10}).json()

    assert summary["income_total"] == 45000
    assert summary["income_received"] == 40000
    assert summary["income_pending"] == 5000
    assert summary["expense_paid"] == 16000
    assert summary["expense_pending"] == 2999.9
    assert summary["expense_total"] == 18999.9
    # Remaining budget = received income − paid − pending (expected income excluded).
    assert summary["remaining_budget"] == 40000 - 16000 - 2999.9
    assert summary["net"] == 45000 - 18999.9
    # Cash actually moved so far = received − paid.
    assert summary["cash_balance"] == 24000

    assert summary["pending_count"] == 3
    assert [p["category"] for p in summary["pending"]] == ["Credit card", "Internet", "Freelance"]
    assert all(p["is_paid"] is False for p in summary["pending"])

    card = next(c for c in summary["by_category"] if c["category"] == "Credit card")
    assert (card["total"], card["paid_total"], card["pending_total"], card["count"]) == (3500, 1000, 2500, 2)

    day14 = next(d for d in summary["daily"] if d["date"] == "2026-10-14")
    assert day14["expense"] == 2500 and day14["expense_pending"] == 2500

    # Paying the card moves it from pending to paid; the remaining budget is unchanged.
    card_entry = next(p for p in summary["pending"] if p["category"] == "Credit card")
    client.post(f"/api/finance/{card_entry['id']}/toggle-paid")
    after = client.get("/api/finance/summary", params={"year": 2026, "month": 10}).json()
    assert after["expense_paid"] == 18500
    assert after["expense_pending"] == 499.9
    assert after["remaining_budget"] == summary["remaining_budget"]
    assert after["pending_count"] == 2


def test_summary_covers_leap_february(client: TestClient) -> None:
    summary = client.get("/api/finance/summary", params={"year": 2028, "month": 2}).json()
    assert len(summary["daily"]) == 29
    assert summary["net"] == 0
    assert summary["pending"] == []


def test_summary_validates_month(client: TestClient) -> None:
    assert client.get("/api/finance/summary", params={"year": 2026, "month": 13}).status_code == 422
