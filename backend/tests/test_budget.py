from app.models import BudgetConfig, BudgetLine, Category


def _seed(session):
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(BudgetConfig(id=1, mode="envelope"))
    session.commit()


def test_put_line_creates_then_updates(client, session):
    _seed(session)
    r = client.put("/api/budget/lines/groceries", json={"monthlyCap": 900, "rollover": True})
    assert r.status_code == 200
    assert r.json() == {"categoryId": "groceries", "monthlyCap": 900.0, "rollover": True}
    r = client.put("/api/budget/lines/groceries", json={"monthlyCap": 750, "rollover": False})
    assert r.json()["monthlyCap"] == 750.0
    session.expire_all()
    assert session.get(BudgetLine, "groceries").rollover is False


def test_put_line_validation(client, session):
    _seed(session)
    assert client.put("/api/budget/lines/groceries", json={"monthlyCap": -5, "rollover": False}).status_code == 422
    assert client.put("/api/budget/lines/unclassified", json={"monthlyCap": 10, "rollover": False}).status_code == 422
    assert client.put("/api/budget/lines/nope", json={"monthlyCap": 10, "rollover": False}).status_code == 404


def test_delete_line(client, session):
    _seed(session)
    client.put("/api/budget/lines/groceries", json={"monthlyCap": 900, "rollover": True})
    assert client.delete("/api/budget/lines/groceries").status_code == 204
    assert client.delete("/api/budget/lines/groceries").status_code == 404


def test_patch_config(client, session):
    _seed(session)
    r = client.patch("/api/budget/config", json={"mode": "zero_based"})
    assert r.status_code == 200
    assert r.json()["mode"] == "zero_based"
    assert client.patch("/api/budget/config", json={"mode": "vibes"}).status_code == 422
    assert client.patch("/api/budget/config", json={"targetSavingsRate": 1.5}).status_code == 422
    r = client.patch("/api/budget/config", json={"targetSavingsRate": 0.25})
    assert r.json()["targetSavingsRate"] == 0.25
