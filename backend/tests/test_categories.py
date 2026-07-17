from app.models import BudgetLine, Category, Rule, Transaction


def _seed(session):
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials", bucket503020="needs"))
    session.add(Transaction(
        id="t1", account_id="chq", date="2026-01-05", raw_merchant="COSTCO",
        merchant="Costco", amount=-50.0, category_id="groceries",
    ))
    session.add(Rule(id="r1", keyword="costco", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.add(BudgetLine(category_id="groceries", monthly_cap=900.0, rollover=True))
    session.commit()


def test_create_category_slugs_and_returns_wire_shape(client, session):
    _seed(session)
    r = client.post("/api/categories", json={"name": "Pet Care!", "group": "family", "bucket503020": "wants"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "pet_care"
    assert body["name"] == "Pet Care!"
    assert body["group"] == "family"
    assert body["bucket503020"] == "wants"


def test_create_duplicate_name_is_409_case_insensitive(client, session):
    _seed(session)
    r = client.post("/api/categories", json={"name": "GROCERIES", "group": "essentials"})
    assert r.status_code == 409


def test_create_rejects_bad_group_and_bucket(client, session):
    _seed(session)
    assert client.post("/api/categories", json={"name": "X", "group": "nope"}).status_code == 422
    assert client.post("/api/categories", json={"name": "X", "group": "family", "bucket503020": "later"}).status_code == 422


def test_patch_updates_fields_and_clears_bucket(client, session):
    _seed(session)
    r = client.patch("/api/categories/groceries", json={"name": "Food", "bucket503020": ""})
    assert r.status_code == 200
    assert r.json()["name"] == "Food"
    assert "bucket503020" not in r.json()


def test_patch_rename_collision_is_409(client, session):
    _seed(session)
    client.post("/api/categories", json={"name": "Dining", "group": "lifestyle"})
    assert client.patch("/api/categories/groceries", json={"name": "dining"}).status_code == 409


def test_patch_rejects_extra_fields(client, session):
    _seed(session)
    assert client.patch("/api/categories/groceries", json={"id": "hack"}).status_code == 422


def test_delete_cascades_and_reports_counts(client, session):
    _seed(session)
    r = client.delete("/api/categories/groceries")
    assert r.status_code == 200
    assert r.json() == {
        "deleted": True, "transactionsReassigned": 1,
        "rulesDeleted": 1, "budgetLineDeleted": True,
    }
    session.expire_all()
    assert session.get(Transaction, "t1").category_id == "unclassified"
    assert session.get(Rule, "r1") is None
    assert session.get(BudgetLine, "groceries") is None
    assert session.get(Category, "groceries") is None


def test_unclassified_is_protected(client, session):
    _seed(session)
    assert client.delete("/api/categories/unclassified").status_code == 422
    assert client.patch("/api/categories/unclassified", json={"name": "X"}).status_code == 422


def test_unknown_category_404(client, session):
    _seed(session)
    assert client.patch("/api/categories/nope", json={"name": "X"}).status_code == 404
    assert client.delete("/api/categories/nope").status_code == 404
