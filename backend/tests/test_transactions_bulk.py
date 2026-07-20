from app.models import Account, Category, Transaction


def _seed(session):
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.add(Account(id="cash_wallet", institution="Cash", account_type="cash", kind="cash", custom_name="Cash"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    for i in (1, 2, 3):
        session.add(Transaction(
            id=f"t{i}", account_id="chq", date="2026-01-0{}".format(i),
            raw_merchant="X", merchant="X", amount=-1.0,
            category_id="unclassified", source="bank",
        ))
    session.add(Transaction(
        id="m1", account_id="cash_wallet", date="2026-01-05", raw_merchant="Cash",
        merchant="Cash", amount=-5.0, category_id="unclassified", source="manual",
    ))
    session.commit()


def test_bulk_recategorize_and_flags(client, session):
    _seed(session)
    r = client.post("/api/transactions/bulk", json={
        "ids": ["t1", "t2"], "categoryId": "groceries", "isTransfer": True,
    })
    assert r.status_code == 200
    assert r.json() == {"updated": 2, "notFound": []}
    session.expire_all()
    assert session.get(Transaction, "t1").category_id == "groceries"
    assert session.get(Transaction, "t1").is_transfer is True
    assert session.get(Transaction, "t3").category_id == "unclassified"  # untouched


def test_bulk_reports_not_found(client, session):
    _seed(session)
    r = client.post("/api/transactions/bulk", json={"ids": ["t1", "nope"], "isDuplicate": True})
    assert r.json() == {"updated": 1, "notFound": ["nope"]}


def test_bulk_unknown_category_422(client, session):
    _seed(session)
    assert client.post("/api/transactions/bulk", json={"ids": ["t1"], "categoryId": "nope"}).status_code == 422


def test_bulk_empty_ids_422(client, session):
    _seed(session)
    assert client.post("/api/transactions/bulk", json={"ids": []}).status_code == 422


def test_bulk_delete_manual_only(client, session):
    _seed(session)
    r = client.post("/api/transactions/bulk-delete", json={"ids": ["m1", "t1", "nope"]})
    assert r.status_code == 200
    assert r.json() == {"deleted": 1, "skippedNonManual": ["t1"], "notFound": ["nope"]}
    session.expire_all()
    assert session.get(Transaction, "m1") is None
    assert session.get(Transaction, "t1") is not None
