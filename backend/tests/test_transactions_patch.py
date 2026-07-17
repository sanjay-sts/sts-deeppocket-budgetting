from sqlmodel import Session

from app.models import Account, Category, Transaction


def _make_tx(engine):
    with Session(engine) as s:
        s.add(Category(id="groceries", name="Groceries", group="essentials"))
        s.add(Category(id="dining", name="Dining", group="lifestyle"))
        s.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
        s.add(Transaction(
            id="tx1", account_id="chq", date="2026-01-05",
            raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
            amount=-73.92, category_id="groceries",
        ))
        s.commit()


def test_patch_reclassifies(client, engine):
    _make_tx(engine)
    r = client.patch("/api/transactions/tx1", json={"categoryId": "dining"})
    assert r.status_code == 200
    assert r.json()["categoryId"] == "dining"


def test_patch_flags_notes_tags(client, engine):
    _make_tx(engine)
    r = client.patch("/api/transactions/tx1", json={
        "isTransfer": True, "isDuplicate": True,
        "notes": "team lunch", "tags": ["work", "reimbursable"],
    })
    body = r.json()
    assert body["isTransfer"] is True and body["isDuplicate"] is True
    assert body["notes"] == "team lunch" and body["tags"] == ["work", "reimbursable"]
    # Clearing: empty string / empty list remove the values from the payload.
    r2 = client.patch("/api/transactions/tx1", json={"notes": "", "tags": []})
    assert "notes" not in r2.json() and "tags" not in r2.json()


def test_patch_unknown_transaction_404(client, engine):
    _make_tx(engine)
    assert client.patch("/api/transactions/nope", json={"notes": "x"}).status_code == 404


def test_patch_unknown_category_422(client, engine):
    _make_tx(engine)
    assert client.patch("/api/transactions/tx1", json={"categoryId": "nope"}).status_code == 422


def test_patch_rejects_bank_facts_422(client, engine):
    _make_tx(engine)
    for bad in ({"amount": 5}, {"date": "2026-01-06"}, {"merchant": "X"}, {"accountId": "other"}):
        assert client.patch("/api/transactions/tx1", json=bad).status_code == 422
