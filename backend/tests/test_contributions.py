def _resp_account(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    kid = client.post("/api/people", json={"name": "Kid", "role": "child", "birthYear": 2015}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp", "beneficiaryIds": [kid]}).json()["id"]
    return pid, kid, aid


def test_resp_contribution_derives_cesg_in_payload(client):
    pid, kid, aid = _resp_account(client)
    r = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01",
        "amount": 1000, "kind": "resp", "beneficiaryId": kid})
    assert r.status_code == 201
    grants = [g for g in client.get("/api/data").json()["cesgGrants"] if g["beneficiaryId"] == kid]
    assert sum(g["amount"] for g in grants) == 200.0


def test_resp_requires_beneficiary(client):
    pid, kid, aid = _resp_account(client)
    r = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01", "amount": 1000, "kind": "resp"})
    assert r.status_code == 422


def test_tfsa_contribution_appears_in_events(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={"personIds": [pid], "institution": "Q", "accountType": "tfsa"}).json()["id"]
    cid = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "20250115", "amount": 500, "kind": "tfsa"}).json()["id"]
    events = client.get("/api/data").json()["contributionEvents"]
    assert any(e["id"] == cid and e["date"] == "2025-01-15" for e in events)


def test_delete_contribution_removes_cesg(client):
    pid, kid, aid = _resp_account(client)
    cid = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01",
        "amount": 1000, "kind": "resp", "beneficiaryId": kid}).json()["id"]
    assert client.delete(f"/api/contributions/{cid}").status_code == 204
    assert [g for g in client.get("/api/data").json()["cesgGrants"] if g["beneficiaryId"] == kid] == []
