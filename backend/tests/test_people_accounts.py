def test_create_and_list_person(client):
    r = client.post("/api/people", json={"name": "Sanjay", "role": "adult", "birthYear": 1985})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["birthYear"] == 1985

    listed = client.get("/api/people").json()
    assert any(p["id"] == pid for p in listed)


def test_update_person(client):
    pid = client.post("/api/people", json={"name": "Anu", "role": "adult"}).json()["id"]
    r = client.put(f"/api/people/{pid}", json={"name": "Anumol"})
    assert r.status_code == 200
    assert r.json()["name"] == "Anumol"


def test_delete_person_blocked_when_owns_account(client):
    pid = client.post("/api/people", json={"name": "Owner", "role": "adult"}).json()["id"]
    client.post("/api/accounts", json={
        "personId": pid, "institution": "Questrade", "accountType": "tfsa"})
    r = client.delete(f"/api/people/{pid}")
    assert r.status_code == 409
    assert "account" in r.json()["detail"].lower()


def test_delete_person_ok_when_no_deps(client):
    pid = client.post("/api/people", json={"name": "Temp", "role": "adult"}).json()["id"]
    assert client.delete(f"/api/people/{pid}").status_code == 204


def test_create_account_defaults_kind_and_name(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personId": pid, "institution": "Sunlife", "accountType": "dccp2"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "dcpp"            # dccp2 -> dcpp via KIND_MAP
    assert body["name"] == "Sunlife dccp2"   # default display name
    assert body["ownerIds"] == [pid]


def test_create_account_natural_key_conflict(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    payload = {"personId": pid, "institution": "Questrade", "accountType": "tfsa"}
    assert client.post("/api/accounts", json=payload).status_code == 201
    assert client.post("/api/accounts", json=payload).status_code == 409


def test_delete_account_blocked_with_snapshots(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personId": pid, "institution": "Q", "accountType": "tfsa"}).json()["id"]
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100})
    r = client.delete(f"/api/accounts/{aid}")
    assert r.status_code == 409
