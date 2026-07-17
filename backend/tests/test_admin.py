from sqlmodel import Session

from seed import seed


def _seed_demo(engine):
    # Seed through the same engine the client uses (mirrors test_data_endpoint).
    with Session(engine) as s:
        seed(s, investments="demo")


def test_purge_investments_keeps_people_drops_investments(client, engine):
    _seed_demo(engine)
    assert len(client.get("/api/people").json()) > 0
    accounts_before = client.get("/api/accounts").json()
    assert len(accounts_before) > 0
    bank_kinds = {"chequing", "savings", "credit_card"}
    bank_ids_before = {a["id"] for a in accounts_before if a["kind"] in bank_kinds}
    assert bank_ids_before  # sanity: fixture data has bank accounts to spare
    assert any(a["kind"] not in bank_kinds for a in accounts_before)  # and investment ones to drop

    r = client.post("/api/admin/purge", json={"mode": "investments"})
    assert r.status_code == 200
    assert r.json() == {"mode": "investments", "ok": True}

    # People survive; bank accounts (and their transactions) survive; only the
    # investment domain is gone.
    assert len(client.get("/api/people").json()) > 0
    accounts_after = client.get("/api/accounts").json()
    assert {a["id"] for a in accounts_after} == bank_ids_before
    assert all(a["kind"] in bank_kinds for a in accounts_after)
    data = client.get("/api/data").json()
    assert data["investments"] == []
    assert data["contributionEvents"] == []
    assert len(data["transactions"]) > 0


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
