"""Property and mortgage account kinds (M5).

A property is an asset valued by snapshots (latest = current market value); a mortgage
is a liability valued the same way (latest = outstanding principal) and linked to its
property via linked_account_id. Purchase info and the rental flag live on the account.
"""
from sqlmodel import Session, select

from app.constants import BANK_KINDS, INVESTMENT_KINDS, PROPERTY_KINDS, normalize_kind
from app.models import Account, Category, Transaction
from app.services.fixtures import build_payload


def _person(client) -> str:
    return client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]


def _property(client, pid: str, **extra) -> dict:
    body = {
        "personIds": [pid], "institution": "142 Maple Grove Ave",
        "accountType": "property", "name": "Maple Grove house",
    }
    body.update(extra)
    return client.post("/api/accounts", json=body).json()


def test_property_and_mortgage_are_recognized_kinds():
    assert normalize_kind("property") == "property"
    assert normalize_kind("house") == "property"
    assert normalize_kind("real estate") == "property"
    assert normalize_kind("mortgage") == "mortgage"
    # The new kinds belong to neither existing family: not bank (no openingBalances
    # entry, no cash math) and not investment (no allocation/returns/contributions).
    assert PROPERTY_KINDS == {"property", "mortgage"}
    assert not PROPERTY_KINDS & BANK_KINDS
    assert not PROPERTY_KINDS & INVESTMENT_KINDS


def test_mortgage_is_always_a_liability(client):
    pid = _person(client)
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "mortgage",
        "isLiability": False,  # wrong flag sent on purpose
    })
    assert r.status_code == 201
    assert r.json()["kind"] == "mortgage"
    assert r.json()["isLiability"] is True


def test_switching_kind_to_mortgage_derives_liability(client):
    pid = _person(client)
    acc = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "loan",
        "kind": "non_registered",
    }).json()
    assert "isLiability" not in acc
    r = client.put(f"/api/accounts/{acc['id']}", json={"kind": "mortgage"})
    assert r.status_code == 200
    assert r.json()["isLiability"] is True


def test_property_fields_round_trip_and_reach_the_payload(client, session: Session):
    pid = _person(client)
    prop = _property(client, pid, isRental=True,
                     purchasePrice=610000.0, purchaseDate="2019-06-28")
    assert prop["kind"] == "property"
    assert prop["isRental"] is True
    assert prop["purchasePrice"] == 610000.0
    assert prop["purchaseDate"] == "2019-06-28"

    payload = build_payload(session)
    out = next(a for a in payload["accounts"] if a["id"] == prop["id"])
    assert out["isRental"] is True
    assert out["purchasePrice"] == 610000.0
    assert out["purchaseDate"] == "2019-06-28"


def test_unset_property_fields_are_absent_not_null(client, session: Session):
    pid = _person(client)
    prop = _property(client, pid)
    payload = build_payload(session)
    out = next(a for a in payload["accounts"] if a["id"] == prop["id"])
    for key in ("isRental", "purchasePrice", "purchaseDate", "linkedAccountId"):
        assert key not in out


def test_purchase_date_is_calendar_validated(client):
    pid = _person(client)
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "88 Birch St", "accountType": "property",
        "purchaseDate": "2026-02-31",
    })
    assert r.status_code == 422


def test_mortgage_link_must_point_at_a_property(client):
    pid = _person(client)
    chequing = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing", "kind": "chequing",
    }).json()
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "mortgage",
        "linkedAccountId": chequing["id"],
    })
    assert r.status_code == 422

    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "mortgage",
        "linkedAccountId": "acc_nonexistent",
    })
    assert r.status_code == 422


def test_mortgage_links_and_unlinks(client):
    pid = _person(client)
    prop = _property(client, pid)
    mort = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "mortgage",
        "linkedAccountId": prop["id"],
    }).json()
    assert mort["linkedAccountId"] == prop["id"]

    # Omitting the field leaves the link alone...
    r = client.put(f"/api/accounts/{mort['id']}", json={"institution": "Birch Lending"})
    assert r.json()["linkedAccountId"] == prop["id"]
    # ...an explicit null clears it.
    r = client.put(f"/api/accounts/{mort['id']}", json={"linkedAccountId": None})
    assert r.status_code == 200
    assert "linkedAccountId" not in r.json()


def test_deleting_a_property_unlinks_but_never_deletes(client, session: Session):
    """The property tag on a transaction is an annotation, not ownership: deleting the
    property must null it (and the mortgage's link), never delete or block."""
    pid = _person(client)
    prop = _property(client, pid)
    mort = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Maple Trust", "accountType": "mortgage",
        "linkedAccountId": prop["id"],
    }).json()
    chequing = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing", "kind": "chequing",
    }).json()
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Transaction(
        id="tx1", account_id=chequing["id"], date="2026-01-05", raw_merchant="RENT DEPOSIT",
        merchant="Rent Deposit", amount=1800.0, category_id="unclassified",
        property_id=prop["id"]))
    session.commit()

    # The tagged transaction lives on ANOTHER account, so it must not block deletion.
    r = client.delete(f"/api/accounts/{prop['id']}")
    assert r.status_code == 204

    session.expire_all()
    tx = session.get(Transaction, "tx1")
    assert tx is not None
    assert tx.property_id is None
    assert session.get(Account, mort["id"]).linked_account_id is None


def test_transaction_property_id_reaches_the_payload(client, session: Session):
    pid = _person(client)
    prop = _property(client, pid)
    chequing = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing", "kind": "chequing",
    }).json()
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Transaction(
        id="tx1", account_id=chequing["id"], date="2026-01-05", raw_merchant="RENT DEPOSIT",
        merchant="Rent Deposit", amount=1800.0, category_id="unclassified",
        property_id=prop["id"]))
    session.add(Transaction(
        id="tx2", account_id=chequing["id"], date="2026-01-06", raw_merchant="COFFEE",
        merchant="Coffee", amount=-4.5, category_id="unclassified"))
    session.commit()

    payload = build_payload(session)
    tx1 = next(t for t in payload["transactions"] if t["id"] == "tx1")
    tx2 = next(t for t in payload["transactions"] if t["id"] == "tx2")
    assert tx1["propertyId"] == prop["id"]
    assert "propertyId" not in tx2
