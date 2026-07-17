from sqlmodel import Session

from app.models import Category


def _seed_categories(engine):
    with Session(engine) as s:
        s.add(Category(id="groceries", name="Groceries", group="essentials"))
        s.add(Category(id="dining", name="Dining", group="lifestyle"))
        s.commit()


def test_rules_crud_roundtrip(client, engine):
    _seed_categories(engine)
    r = client.post("/api/rules", json={"keyword": "costco", "categoryId": "groceries"})
    assert r.status_code == 200
    rule = r.json()
    assert rule["keyword"] == "costco" and rule["categoryId"] == "groceries"
    assert rule["createdAt"]

    assert client.get("/api/rules").json() == [rule]

    r2 = client.put(f"/api/rules/{rule['id']}", json={"categoryId": "dining"})
    assert r2.status_code == 200 and r2.json()["categoryId"] == "dining"

    assert client.delete(f"/api/rules/{rule['id']}").status_code == 204
    assert client.get("/api/rules").json() == []


def test_rule_validation(client, engine):
    _seed_categories(engine)
    assert client.post("/api/rules", json={"keyword": "  ", "categoryId": "groceries"}).status_code == 422
    assert client.post("/api/rules", json={"keyword": "x", "categoryId": "nope"}).status_code == 422
    client.post("/api/rules", json={"keyword": "Costco", "categoryId": "groceries"})
    assert client.post("/api/rules", json={"keyword": "COSTCO", "categoryId": "dining"}).status_code == 409
    assert client.put("/api/rules/nope", json={"keyword": "y"}).status_code == 404
    assert client.delete("/api/rules/nope").status_code == 404
