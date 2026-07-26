# Recurring auto-deposits: schedules that materialize contribution events — issue #28.


def _setup(client, account_type="rrsp"):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "Q", "accountType": account_type}).json()["id"]
    return pid, aid


def _schedule(client, pid, aid, **over):
    body = {"accountId": aid, "personId": pid, "kind": "rrsp", "amount": 500,
            "frequency": "monthly", "startDate": "2026-01-15", **over}
    return client.post("/api/recurring", json=body)


def _events(client, sid=None):
    # /api/contributions, NOT /api/data — the data route materializes up to the real
    # current date, which would pollute these fixed-"today" scenarios.
    evs = client.get("/api/contributions").json()
    if sid is None:
        return evs
    return [e for e in evs if e.get("recurringId") == sid]


def test_create_and_list_schedule(client):
    pid, aid = _setup(client)
    r = _schedule(client, pid, aid)
    assert r.status_code == 201
    sid = r.json()["id"]
    assert r.json()["frequency"] == "monthly"
    assert any(s["id"] == sid for s in client.get("/api/recurring").json())
    payload = client.get("/api/data").json()
    assert any(s["id"] == sid and s["paused"] is False
               for s in payload["recurringContributions"])


def test_validation(client):
    pid, aid = _setup(client)
    assert _schedule(client, pid, aid, kind="lira").status_code == 422
    assert _schedule(client, pid, aid, frequency="daily").status_code == 422
    assert _schedule(client, pid, aid, amount=0).status_code == 422
    assert _schedule(client, pid, aid, kind="resp").status_code == 422  # no beneficiary
    assert _schedule(client, pid, aid, startDate="not-a-date").status_code == 422


def test_monthly_materialization_is_idempotent(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid).json()["id"]
    r = client.post("/api/recurring/materialize", json={"today": "2026-03-20"})
    assert r.json()["created"] == 3
    dates = sorted(e["date"] for e in _events(client, sid))
    assert dates == ["2026-01-15", "2026-02-15", "2026-03-15"]
    assert client.post("/api/recurring/materialize", json={"today": "2026-03-20"}).json()["created"] == 0


def test_monthly_clamps_to_month_end(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid, startDate="2026-01-31").json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-03-05"})
    assert sorted(e["date"] for e in _events(client, sid)) == ["2026-01-31", "2026-02-28"]


def test_weekly_and_biweekly(client):
    pid, aid = _setup(client)
    wid = _schedule(client, pid, aid, frequency="weekly", startDate="2026-03-01").json()["id"]
    bid = _schedule(client, pid, aid, frequency="biweekly", startDate="2026-03-01").json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-03-15"})
    assert sorted(e["date"] for e in _events(client, wid)) == ["2026-03-01", "2026-03-08", "2026-03-15"]
    assert sorted(e["date"] for e in _events(client, bid)) == ["2026-03-01", "2026-03-15"]


def test_semi_monthly(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid, frequency="semi_monthly", startDate="2026-01-10").json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-02-20"})
    assert sorted(e["date"] for e in _events(client, sid)) == ["2026-01-15", "2026-02-01", "2026-02-15"]


def test_paused_schedule_does_not_backfill_on_resume(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid).json()["id"]
    client.put(f"/api/recurring/{sid}", json={"paused": True})
    client.post("/api/recurring/materialize", json={"today": "2026-03-20"})
    assert _events(client, sid) == []
    # The paused window is consumed, not deferred: those deposits never happened at
    # the bank, so resuming must only generate occurrences after the resume.
    client.put(f"/api/recurring/{sid}", json={"paused": False})
    client.post("/api/recurring/materialize", json={"today": "2026-04-20"})
    assert sorted(e["date"] for e in _events(client, sid)) == ["2026-04-15"]


def test_end_date_bounds_occurrences(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid, endDate="2026-02-01").json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-03-20"})
    assert sorted(e["date"] for e in _events(client, sid)) == ["2026-01-15"]


def test_materialize_rejects_bad_date(client):
    assert client.post("/api/recurring/materialize", json={"today": "not-a-date"}).status_code == 422
    # right shape, impossible calendar date
    assert client.post("/api/recurring/materialize", json={"today": "2026-13-01"}).status_code == 422


def test_exact_duplicate_schedule_rejected(client):
    pid, aid = _setup(client)
    assert _schedule(client, pid, aid).status_code == 201
    assert _schedule(client, pid, aid).status_code == 409
    # a different amount is a genuinely different standing order
    assert _schedule(client, pid, aid, amount=750).status_code == 201


def test_deleted_occurrence_is_not_resurrected(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid).json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-02-20"})
    victim = next(e for e in _events(client, sid) if e["date"] == "2026-01-15")
    assert client.delete(f"/api/contributions/{victim['id']}").status_code == 204
    client.post("/api/recurring/materialize", json={"today": "2026-03-20"})
    assert sorted(e["date"] for e in _events(client, sid)) == ["2026-02-15", "2026-03-15"]


def test_delete_schedule_keeps_events(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid).json()["id"]
    client.post("/api/recurring/materialize", json={"today": "2026-02-20"})
    ids = {e["id"] for e in _events(client, sid)}
    assert len(ids) == 2
    assert client.delete(f"/api/recurring/{sid}").status_code == 204
    assert client.get("/api/recurring").json() == []
    remaining = {e["id"] for e in _events(client)}
    assert ids <= remaining  # deposits survive; they really happened


def test_resp_recurring_derives_cesg(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    kid = client.post("/api/people", json={"name": "K", "role": "child"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personIds": [pid], "institution": "WS", "accountType": "resp",
        "beneficiaryIds": [kid]}).json()["id"]
    # endDate bounds the schedule so the /api/data read below (which materializes up to
    # the real current date) can't add occurrences beyond the two under test.
    _schedule(client, pid, aid, kind="resp", beneficiaryId=kid, amount=1000,
              startDate="2026-01-15", endDate="2026-02-20")
    client.post("/api/recurring/materialize", json={"today": "2026-02-20"})
    grants = [g for g in client.get("/api/data").json()["cesgGrants"] if g["beneficiaryId"] == kid]
    assert sum(g["amount"] for g in grants) == 400.0  # 20% of 2 x 1000


def test_data_endpoint_materializes_with_real_today(client):
    pid, aid = _setup(client)
    sid = _schedule(client, pid, aid, startDate="2026-07-01").json()["id"]
    payload = client.get("/api/data").json()  # materializes as a side effect
    assert len([e for e in payload["contributionEvents"] if e.get("recurringId") == sid]) >= 1
