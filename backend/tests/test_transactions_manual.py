from app.models import Account, Category, Rule, Transaction


def _seed(session):
    session.add(Account(id="cash_wallet", institution="Cash", account_type="cash", kind="cash", custom_name="Cash"))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(Rule(id="r1", keyword="farm", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.commit()


def _create(client, **overrides):
    body = {"accountId": "cash_wallet", "date": "2026-07-10", "merchant": "Farm Boy", "amount": -20.5}
    body.update(overrides)
    return client.post("/api/transactions", json=body)


def test_create_manual_with_explicit_category(client, session):
    _seed(session)
    r = _create(client, categoryId="groceries", notes="cash", tags=["market"])
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "manual"
    assert body["categoryId"] == "groceries"
    assert body["rawMerchant"] == "Farm Boy"
    assert body["tags"] == ["market"]
    assert body["id"].startswith("txn_m_")


def test_create_auto_categorizes_when_category_omitted(client, session):
    _seed(session)
    r = _create(client)
    assert r.json()["categoryId"] == "groceries"  # matched rule 'farm'


def test_create_validation(client, session):
    _seed(session)
    assert _create(client, accountId="nope").status_code == 404
    assert _create(client, date="07/10/2026").status_code == 422
    assert _create(client, merchant="  ").status_code == 422
    assert _create(client, amount=0).status_code == 422
    assert _create(client, categoryId="nope").status_code == 422


def test_patch_manual_facts_editable(client, session):
    _seed(session)
    tx_id = _create(client).json()["id"]
    r = client.patch(f"/api/transactions/{tx_id}", json={
        "date": "2026-07-11", "merchant": "Farmboy #2", "amount": -25.0, "accountId": "chq",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-07-11"
    assert body["merchant"] == "Farmboy #2"
    assert body["rawMerchant"] == "Farmboy #2"
    assert body["amount"] == -25.0
    assert body["accountId"] == "chq"


def test_patch_bank_facts_still_locked(client, session):
    _seed(session)
    session.add(Transaction(
        id="tb", account_id="chq", date="2026-01-05", raw_merchant="X",
        merchant="X", amount=-1.0, category_id="unclassified", source="bank",
    ))
    session.commit()
    for field, value in (("date", "2026-01-06"), ("merchant", "Y"), ("amount", -2.0), ("accountId", "cash_wallet")):
        assert client.patch("/api/transactions/tb", json={field: value}).status_code == 422


def test_delete_manual_only(client, session):
    _seed(session)
    tx_id = _create(client).json()["id"]
    session.add(Transaction(
        id="tb", account_id="chq", date="2026-01-05", raw_merchant="X",
        merchant="X", amount=-1.0, category_id="unclassified", source="bank",
    ))
    session.commit()
    assert client.delete(f"/api/transactions/{tx_id}").status_code == 204
    assert client.delete("/api/transactions/tb").status_code == 422
    assert client.delete("/api/transactions/nope").status_code == 404
