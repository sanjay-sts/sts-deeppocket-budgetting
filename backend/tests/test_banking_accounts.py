"""Creating chequing/savings/credit-card accounts through the API.

Until now nothing exercised POST /api/accounts with a banking kind, and nothing could
create one from the UI at all — which is what made a credit-card CSV import unresolvable.
"""
from sqlmodel import Session, select

from app.constants import BANK_KINDS, normalize_kind
from app.models import Account, Category, Transaction


def _person(client) -> str:
    return client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]


def test_normalize_kind_maps_banking_types():
    # Without these, a credit card landed as non_registered and fell out of BANK_KINDS,
    # taking it out of meta.openingBalances and every cash/credit KPI.
    assert normalize_kind("credit_card") == "credit_card"
    assert normalize_kind("Credit_Card") == "credit_card"
    assert normalize_kind("chequing") == "chequing"
    assert normalize_kind("checking") == "chequing"
    assert normalize_kind("savings") == "savings"
    for kind in ("credit_card", "chequing", "savings"):
        assert kind in BANK_KINDS
    # Unchanged: for the investment importer, account_type "cash" is a cash/margin account.
    assert normalize_kind("cash") == "non_registered"


def test_create_credit_card_derives_kind_and_forces_liability(client):
    pid = _person(client)
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "credit_card",
        "name": "Sanjay TD AeroPlan Card",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "credit_card"
    # isLiability was never sent, but a card is always a liability.
    assert body["isLiability"] is True
    assert body["name"] == "Sanjay TD AeroPlan Card"
    assert body["customName"] == "Sanjay TD AeroPlan Card"


def test_create_credit_card_ignores_a_wrong_liability_flag(client):
    pid = _person(client)
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "visa",
        "kind": "credit_card", "isLiability": False,
    })
    assert r.status_code == 201
    assert r.json()["isLiability"] is True


def test_switching_an_account_to_credit_card_makes_it_a_liability(client):
    pid = _person(client)
    acc = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing", "kind": "chequing",
    }).json()
    assert "isLiability" not in acc  # omitted when false

    r = client.put(f"/api/accounts/{acc['id']}", json={"kind": "credit_card"})
    assert r.status_code == 200
    assert r.json()["isLiability"] is True


def test_opening_balance_round_trips_into_the_payload(client):
    pid = _person(client)
    acc = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing",
        "kind": "chequing", "openingBalance": 1250.75,
    }).json()

    balances = client.get("/api/data").json()["meta"]["openingBalances"]
    assert balances[acc["id"]] == 1250.75

    client.put(f"/api/accounts/{acc['id']}", json={"openingBalance": 90.0})
    assert client.get("/api/data").json()["meta"]["openingBalances"][acc["id"]] == 90.0

    # Omitting the field leaves it alone rather than resetting it to zero.
    client.put(f"/api/accounts/{acc['id']}", json={"institution": "TD Canada Trust"})
    assert client.get("/api/data").json()["meta"]["openingBalances"][acc["id"]] == 90.0


def test_delete_is_blocked_by_transactions_then_cascades_them(client, session: Session):
    pid = _person(client)
    acc = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "credit_card",
    }).json()
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Transaction(
        id="tx1", account_id=acc["id"], date="2026-01-05", raw_merchant="SHOP",
        merchant="Shop", amount=-10.0, category_id="unclassified"))
    session.commit()

    blocked = client.delete(f"/api/accounts/{acc['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["transactionCount"] == 1

    forced = client.delete(f"/api/accounts/{acc['id']}?cascade=true")
    assert forced.status_code == 204
    # Transactions used to outlive the account, stranding every imported row.
    assert session.exec(select(Transaction)).all() == []
    assert session.get(Account, acc["id"]) is None
