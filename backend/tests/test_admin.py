from sqlmodel import Session

from seed import seed


def _seed_demo(engine):
    # Seed through the same engine the client uses (mirrors test_data_endpoint).
    with Session(engine) as s:
        seed(s, investments="demo")


def test_purge_investments_keeps_people_drops_investments(client, engine):
    _seed_demo(engine)
    assert len(client.get("/api/people").json()) > 0
    assert len(client.get("/api/accounts").json()) > 0

    r = client.post("/api/admin/purge", json={"mode": "investments"})
    assert r.status_code == 200
    assert r.json() == {"mode": "investments", "ok": True}

    # People survive; the whole investment domain is gone.
    assert len(client.get("/api/people").json()) > 0
    assert client.get("/api/accounts").json() == []
    data = client.get("/api/data").json()
    assert data["investments"] == []
    assert data["contributionEvents"] == []


def test_purge_all_removes_people_and_accounts(client, engine):
    _seed_demo(engine)
    assert len(client.get("/api/people").json()) > 0

    r = client.post("/api/admin/purge", json={"mode": "all"})
    assert r.status_code == 200
    assert r.json() == {"mode": "all", "ok": True}

    assert client.get("/api/people").json() == []
    assert client.get("/api/accounts").json() == []


def test_purge_demo_restores_people_and_accounts(client):
    # Start from the empty conftest DB to prove demo repopulates from nothing.
    assert client.get("/api/people").json() == []
    assert client.get("/api/accounts").json() == []

    r = client.post("/api/admin/purge", json={"mode": "demo"})
    assert r.status_code == 200
    assert r.json() == {"mode": "demo", "ok": True}

    assert len(client.get("/api/people").json()) > 0
    assert len(client.get("/api/accounts").json()) > 0


def test_purge_rejects_unknown_mode(client):
    assert client.post("/api/admin/purge", json={"mode": "nope"}).status_code == 422
