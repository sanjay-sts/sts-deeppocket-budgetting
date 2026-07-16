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
    body = r.json()["detail"]
    assert body["ownedAccountCount"] == 1
    assert body["beneficiaryAccountCount"] == 0
    assert body["contributionCount"] == 0


def test_delete_person_ok_when_no_deps(client):
    pid = client.post("/api/people", json={"name": "Temp", "role": "adult"}).json()["id"]
    assert client.delete(f"/api/people/{pid}").status_code == 204


def test_create_account_defaults_kind_and_name(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Sunlife", "accountType": "dccp2"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "dcpp"                   # dccp2 -> dcpp via KIND_MAP
    # Computed display name = owner(s) + institution + account type; no custom override.
    assert body["name"] == "Sanjay Sunlife dccp2"
    assert "customName" not in body
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
    body = r.json()["detail"]
    assert body["snapshotCount"] == 1
    assert body["contributionCount"] == 0


def test_delete_account_blocked_with_only_contribution(client):
    pid = client.post("/api/people", json={"name": "ContribOnly", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Q", "accountType": "tfsa"}).json()["id"]
    client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-01-15", "amount": 500, "kind": "tfsa"})
    r = client.delete(f"/api/accounts/{aid}")
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["snapshotCount"] == 0
    assert body["contributionCount"] == 1


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
    body = r.json()["detail"]
    assert body["ownedAccountCount"] == 1
    assert body["beneficiaryAccountCount"] == 0
    assert body["contributionCount"] == 0


def test_delete_person_blocked_when_family_resp_co_beneficiary(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]})
    r = client.delete(f"/api/people/{k2}")
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["ownedAccountCount"] == 0
    assert body["beneficiaryAccountCount"] == 1
    assert body["contributionCount"] == 0


def test_delete_person_blocked_when_only_contribution(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    contributor = client.post("/api/people", json={"name": "Contributor", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "tfsa"}).json()["id"]
    client.post("/api/contributions", json={
        "accountId": aid, "personId": contributor, "date": "2025-01-15", "amount": 250, "kind": "tfsa"})
    r = client.delete(f"/api/people/{contributor}")
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["ownedAccountCount"] == 0
    assert body["beneficiaryAccountCount"] == 0
    assert body["contributionCount"] == 1


def test_delete_account_cleans_up_owner_and_beneficiary_rows(client):
    # Regression: deleting an account must not leave orphaned owner/beneficiary join
    # rows behind, or those people can never be deleted afterwards ("beneficiary of a
    # ghost account"). See delete_account.
    owner = client.post("/api/people", json={"name": "Owner", "role": "adult"}).json()["id"]
    k1 = client.post("/api/people", json={"name": "Kid1", "role": "child"}).json()["id"]
    k2 = client.post("/api/people", json={"name": "Kid2", "role": "child"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [owner], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [k1, k2]}).json()["id"]

    assert client.delete(f"/api/accounts/{aid}").status_code == 204

    # With the join rows cleaned up, none of these people are blocked any longer.
    assert client.delete(f"/api/people/{owner}").status_code == 204
    assert client.delete(f"/api/people/{k1}").status_code == 204
    assert client.delete(f"/api/people/{k2}").status_code == 204


def test_delete_account_cascade_removes_dependents(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Q", "accountType": "tfsa"}).json()["id"]
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100})
    client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-01-15", "amount": 500, "kind": "tfsa"})

    # Plain delete is blocked because dependents exist...
    assert client.delete(f"/api/accounts/{aid}").status_code == 409
    # ...but cascade removes the account and all its dependents in one action.
    assert client.delete(f"/api/accounts/{aid}?cascade=true").status_code == 204

    # The account is gone (second delete 404s, and it's absent from the listing).
    assert client.delete(f"/api/accounts/{aid}").status_code == 404
    assert all(a["id"] != aid for a in client.get("/api/accounts").json())
    # ...and so are its snapshot + contribution.
    data = client.get("/api/data").json()
    assert all(s["accountId"] != aid for s in data["investments"])
    assert all(c["accountId"] != aid for c in data["contributionEvents"])
    # The owner is no longer blocked from deletion.
    assert client.delete(f"/api/people/{pid}").status_code == 204


def test_account_name_computed_from_single_owner(client):
    # (a) One owner, no custom name -> computed "{owner} {institution} {type}", no customName.
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WealthSimple", "accountType": "tfsa"}).json()["id"]

    listed = next(a for a in client.get("/api/accounts").json() if a["id"] == aid)
    assert listed["name"] == "Sanjay WealthSimple tfsa"
    assert "customName" not in listed

    data_acc = next(a for a in client.get("/api/data").json()["accounts"] if a["id"] == aid)
    assert data_acc["name"] == "Sanjay WealthSimple tfsa"
    assert "customName" not in data_acc


def test_account_name_joins_multiple_owners_with_comma(client):
    # (b) Joint account -> owner names (sorted-id order) comma-joined, then institution + type.
    p1 = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    p2 = client.post("/api/people", json={"name": "Anumol", "role": "adult"}).json()["id"]
    names = {p1: "Sanjay", p2: "Anumol"}
    aid = client.post("/api/accounts", json={
        "personIds": [p1, p2], "institution": "WealthSimple", "accountType": "tfsa"}).json()["id"]

    owners_joined = ", ".join(names[pid] for pid in sorted([p1, p2]))
    expected = f"{owners_joined} WealthSimple tfsa"

    listed = next(a for a in client.get("/api/accounts").json() if a["id"] == aid)
    assert listed["name"] == expected
    assert "customName" not in listed


def test_account_custom_name_on_create_and_update(client):
    # (c) Create with a name -> that custom string wins and customName is present.
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "tfsa", "name": "My Rainy Day"})
    body = r.json()
    aid = body["id"]
    assert body["name"] == "My Rainy Day"
    assert body["customName"] == "My Rainy Day"

    # Updating with a new name replaces the override.
    updated = client.put(f"/api/accounts/{aid}", json={"name": "Emergency Fund"}).json()
    assert updated["name"] == "Emergency Fund"
    assert updated["customName"] == "Emergency Fund"


def test_account_name_recomputes_when_owners_change(client):
    # (d) Changing the owner set recomputes the auto name.
    p1 = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    p2 = client.post("/api/people", json={"name": "Anumol", "role": "adult"}).json()["id"]
    names = {p1: "Sanjay", p2: "Anumol"}
    aid = client.post("/api/accounts", json={
        "personIds": [p1], "institution": "WS", "accountType": "tfsa"}).json()["id"]
    assert client.get("/api/accounts").json()  # sanity

    updated = client.put(f"/api/accounts/{aid}", json={"personIds": [p1, p2]}).json()
    owners_joined = ", ".join(names[pid] for pid in sorted([p1, p2]))
    assert updated["name"] == f"{owners_joined} WS tfsa"
    assert "customName" not in updated


def test_account_name_recomputes_when_owner_renamed(client):
    # (e) Renaming a person via PUT /api/people recomputes the account name on next read.
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "tfsa"}).json()["id"]

    client.put(f"/api/people/{pid}", json={"name": "Sanjay S"})

    listed = next(a for a in client.get("/api/accounts").json() if a["id"] == aid)
    assert listed["name"] == "Sanjay S WS tfsa"
    data_acc = next(a for a in client.get("/api/data").json()["accounts"] if a["id"] == aid)
    assert data_acc["name"] == "Sanjay S WS tfsa"


def test_account_name_blank_clears_custom_override(client):
    # (f) Updating the name to "" clears the override, reverting to the auto name.
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "tfsa", "name": "Custom"}).json()["id"]
    assert client.get("/api/accounts").json()[0]["customName"] == "Custom"

    reverted = client.put(f"/api/accounts/{aid}", json={"name": ""}).json()
    assert reverted["name"] == "Sanjay WS tfsa"
    assert "customName" not in reverted


def test_delete_person_cascade(client):
    a = client.post("/api/people", json={"name": "A", "role": "adult"}).json()["id"]
    b = client.post("/api/people", json={"name": "B", "role": "adult"}).json()["id"]

    # A solely owns this account (with a snapshot).
    sole = client.post("/api/accounts", json={
        "personIds": [a], "institution": "Sole", "accountType": "tfsa"}).json()["id"]
    client.post("/api/snapshots", json={"accountId": sole, "date": "2025-01-31", "amount": 100})

    # A co-owns this RESP with B and is also listed as a beneficiary of it.
    resp = client.post("/api/accounts", json={
        "personIds": [a, b], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [a]}).json()["id"]
    # A made a contribution to the co-owned RESP.
    client.post("/api/contributions", json={
        "accountId": resp, "personId": a, "date": "2025-01-15", "amount": 250, "kind": "resp"})

    # Plain delete is blocked...
    assert client.delete(f"/api/people/{a}").status_code == 409
    # ...cascade drops A everywhere in one action.
    assert client.delete(f"/api/people/{a}?cascade=true").status_code == 204

    accounts = {acct["id"]: acct for acct in client.get("/api/accounts").json()}
    # The solely-owned account is fully removed.
    assert sole not in accounts
    # The co-owned RESP survives, but A is no longer an owner or beneficiary of it.
    assert resp in accounts
    assert accounts[resp]["ownerIds"] == [b]
    assert a not in accounts[resp].get("beneficiaryIds", [])
    # A's contribution is gone, and A itself is gone.
    data = client.get("/api/data").json()
    assert all(c["personId"] != a for c in data["contributionEvents"])
    assert all(p["id"] != a for p in client.get("/api/people").json())
    # A is fully gone (a second delete 404s).
    assert client.delete(f"/api/people/{a}").status_code == 404
