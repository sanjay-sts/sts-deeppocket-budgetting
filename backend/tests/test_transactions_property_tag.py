"""Tagging transactions to a property (M5).

property_id is user-editable metadata like category_id — never a bank fact — so it is
settable on bank-imported rows, singly and in bulk. It must reference an existing
property account (anything else would silently corrupt the per-property cashflow),
and an empty string clears it, mirroring notes.
"""
from sqlmodel import Session

from app.models import Category, Transaction


def _person(client) -> str:
    return client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]


def _setup(client, session: Session) -> tuple[str, str]:
    """Returns (property_id, chequing_id) with two bank transactions tx1/tx2 seeded."""
    pid = _person(client)
    prop = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "88 Birch St", "accountType": "property",
        "name": "Birch St rental", "isRental": True,
    }).json()
    chq = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "TD", "accountType": "chequing", "kind": "chequing",
    }).json()
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    for i in (1, 2):
        session.add(Transaction(
            id=f"tx{i}", account_id=chq["id"], date=f"2026-01-0{i}",
            raw_merchant="RENT DEPOSIT", merchant="Rent Deposit", amount=1800.0,
            category_id="unclassified"))
    session.commit()
    return prop["id"], chq["id"]


def test_patch_sets_property_on_a_bank_row(client, session: Session):
    prop_id, _ = _setup(client, session)
    r = client.patch("/api/transactions/tx1", json={"propertyId": prop_id})
    assert r.status_code == 200
    assert r.json()["propertyId"] == prop_id


def test_patch_rejects_unknown_or_non_property_target(client, session: Session):
    prop_id, chq_id = _setup(client, session)
    assert client.patch("/api/transactions/tx1",
                        json={"propertyId": "acc_ghost"}).status_code == 422
    # A real account of the wrong kind is just as corrupting as a ghost.
    assert client.patch("/api/transactions/tx1",
                        json={"propertyId": chq_id}).status_code == 422


def test_patch_empty_string_clears_the_tag(client, session: Session):
    prop_id, _ = _setup(client, session)
    client.patch("/api/transactions/tx1", json={"propertyId": prop_id})
    r = client.patch("/api/transactions/tx1", json={"propertyId": ""})
    assert r.status_code == 200
    assert "propertyId" not in r.json()


def test_bulk_tags_and_clears(client, session: Session):
    prop_id, _ = _setup(client, session)
    r = client.post("/api/transactions/bulk", json={"ids": ["tx1", "tx2"], "propertyId": prop_id})
    assert r.status_code == 200
    assert r.json()["updated"] == 2
    session.expire_all()
    assert session.get(Transaction, "tx1").property_id == prop_id
    assert session.get(Transaction, "tx2").property_id == prop_id

    r = client.post("/api/transactions/bulk", json={"ids": ["tx1"], "propertyId": ""})
    assert r.status_code == 200
    session.expire_all()
    assert session.get(Transaction, "tx1").property_id is None
    assert session.get(Transaction, "tx2").property_id == prop_id


def test_bulk_validates_the_property_before_touching_anything(client, session: Session):
    prop_id, chq_id = _setup(client, session)
    r = client.post("/api/transactions/bulk", json={"ids": ["tx1", "tx2"], "propertyId": chq_id})
    assert r.status_code == 422
    session.expire_all()
    assert session.get(Transaction, "tx1").property_id is None
