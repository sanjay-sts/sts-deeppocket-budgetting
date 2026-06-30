def _person_account(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personId": pid, "institution": "Q", "accountType": "tfsa"}).json()["id"]
    return aid


def test_upsert_creates_then_overwrites(client):
    aid = _person_account(client)
    r1 = client.post("/api/snapshots", json={"accountId": aid, "date": "20250131", "amount": 100})
    assert r1.status_code == 200
    assert r1.json()["date"] == "2025-01-31"  # normalized from YYYYMMDD
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 250})
    rows = client.get(f"/api/snapshots?account_id={aid}").json()
    assert len(rows) == 1 and rows[0]["amount"] == 250


def test_edit_and_delete_snapshot(client):
    aid = _person_account(client)
    sid = client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100}).json()["id"]
    assert client.put(f"/api/snapshots/{sid}", json={"amount": 500}).json()["amount"] == 500
    assert client.delete(f"/api/snapshots/{sid}").status_code == 204
    assert client.get(f"/api/snapshots?account_id={aid}").json() == []


def test_bad_date_rejected(client):
    aid = _person_account(client)
    r = client.post("/api/snapshots", json={"accountId": aid, "date": "31-01-2025", "amount": 100})
    assert r.status_code == 422
