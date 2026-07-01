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
        "personIds": [pid], "institution": "Questrade", "accountType": "tfsa"})
    r = client.delete(f"/api/people/{pid}")
    assert r.status_code == 409
    assert "account" in r.json()["detail"].lower()


def test_delete_person_ok_when_no_deps(client):
    pid = client.post("/api/people", json={"name": "Temp", "role": "adult"}).json()["id"]
    assert client.delete(f"/api/people/{pid}").status_code == 204


def test_create_account_defaults_kind_and_name(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Sunlife", "accountType": "dccp2"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "dcpp"            # dccp2 -> dcpp via KIND_MAP
    assert body["name"] == "Sunlife dccp2"   # default display name
    assert body["ownerIds"] == [pid]
    assert body["accountType"] == "dccp2"


def test_create_account_natural_key_conflict(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    payload = {"personIds": [pid], "institution": "Questrade", "accountType": "tfsa"}
    assert client.post("/api/accounts", json=payload).status_code == 201
    assert client.post("/api/accounts", json=payload).status_code == 409


def test_create_account_requires_at_least_one_owner(client):
    r = client.post("/api/accounts", json={
        "personIds": [], "institution": "Questrade", "accountType": "tfsa"})
    assert r.status_code == 422


def test_delete_account_blocked_with_snapshots(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Q", "accountType": "tfsa"}).json()["id"]
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100})
    r = client.delete(f"/api/accounts/{aid}")
    assert r.status_code == 409


def test_create_joint_account_with_two_owners(client):
    p1 = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    p2 = client.post("/api/people", json={"name": "Anumol", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personIds": [p1, p2], "institution": "TD", "accountType": "chequing"})
    assert r.status_code == 201
    aid = r.json()["id"]
    assert sorted(r.json()["ownerIds"]) == sorted([p1, p2])

    data_accounts = client.get("/api/data").json()["accounts"]
    joint = next(a for a in data_accounts if a["id"] == aid)
    assert sorted(joint["ownerIds"]) == sorted([p1, p2])


def test_create_family_resp_with_two_beneficiaries(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]})
    assert r.status_code == 201
    aid = r.json()["id"]
    assert sorted(r.json()["beneficiaryIds"]) == sorted([k1, k2])

    data_accounts = client.get("/api/data").json()["accounts"]
    family_resp = next(a for a in data_accounts if a["id"] == aid)
    assert sorted(family_resp["beneficiaryIds"]) == sorted([k1, k2])


def test_individual_resp_for_one_kid_coexists_with_family_resp(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]})
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1]})
    assert r.status_code == 201


def test_exact_duplicate_owner_and_beneficiary_set_still_conflicts(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    payload = {
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]}
    assert client.post("/api/accounts", json=payload).status_code == 201
    # same institution/type/owners/beneficiaries, order-independent
    dup_payload = {**payload, "beneficiaryIds": [k2, k1]}
    assert client.post("/api/accounts", json=dup_payload).status_code == 409


def test_delete_person_blocked_when_joint_owner(client):
    p1 = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    p2 = client.post("/api/people", json={"name": "Anumol", "role": "adult"}).json()["id"]
    client.post("/api/accounts", json={
        "personIds": [p1, p2], "institution": "TD", "accountType": "chequing"})
    r = client.delete(f"/api/people/{p2}")
    assert r.status_code == 409


def test_delete_person_blocked_when_family_resp_co_beneficiary(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]})
    r = client.delete(f"/api/people/{k2}")
    assert r.status_code == 409
