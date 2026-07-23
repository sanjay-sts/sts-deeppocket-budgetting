# Stated (CRA carry-forward) contribution room per person — issue #25.


def _adult(client, name="S"):
    return client.post("/api/people", json={"name": name, "role": "adult"}).json()["id"]


def test_upsert_creates_and_appears_in_payload(client):
    pid = _adult(client)
    r = client.put("/api/room", json={"personId": pid, "kind": "tfsa", "amount": 42000})
    assert r.status_code == 200
    assert r.json() == {"personId": pid, "kind": "tfsa", "amount": 42000.0}
    assert client.get("/api/room").json() == [{"personId": pid, "kind": "tfsa", "amount": 42000.0}]
    assert client.get("/api/data").json()["statedRoom"] == [
        {"personId": pid, "kind": "tfsa", "amount": 42000.0}]


def test_upsert_same_person_kind_updates_in_place(client):
    pid = _adult(client)
    client.put("/api/room", json={"personId": pid, "kind": "rrsp", "amount": 10000})
    client.put("/api/room", json={"personId": pid, "kind": "rrsp", "amount": 25000})
    rows = client.get("/api/room").json()
    assert rows == [{"personId": pid, "kind": "rrsp", "amount": 25000.0}]


def test_rejects_bad_kind_person_and_amount(client):
    pid = _adult(client)
    # resp room is per-beneficiary CESG pacing, not stated room — rejected too
    assert client.put("/api/room", json={"personId": pid, "kind": "resp", "amount": 1}).status_code == 422
    assert client.put("/api/room", json={"personId": pid, "kind": "lira", "amount": 1}).status_code == 422
    assert client.put("/api/room", json={"personId": "p_missing", "kind": "tfsa", "amount": 1}).status_code == 404
    assert client.put("/api/room", json={"personId": pid, "kind": "tfsa", "amount": -5}).status_code == 422


def test_delete_removes_entry(client):
    pid = _adult(client)
    client.put("/api/room", json={"personId": pid, "kind": "fhsa", "amount": 16000})
    assert client.delete(f"/api/room/{pid}/fhsa").status_code == 204
    assert client.get("/api/room").json() == []
    assert client.get("/api/data").json()["statedRoom"] == []
    assert client.delete(f"/api/room/{pid}/fhsa").status_code == 404
