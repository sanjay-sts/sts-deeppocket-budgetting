"""Household members carry a recorded income (issue #23).

RRSP room is 18% of prior-year earned income and the refund estimate needs a marginal
rate, so without a stored income the Investments page has to guess. 'Not recorded' and
'recorded as zero' are different states and must stay distinguishable.
"""


def _create(client, **over):
    body = {"name": "Avery", "role": "adult", **over}
    return client.post("/api/people", json=body)


def test_create_person_with_income_round_trips(client):
    r = _create(client, grossIncome=118500)
    assert r.status_code == 201
    assert r.json()["grossIncome"] == 118500
    pid = r.json()["id"]
    person = next(p for p in client.get("/api/data").json()["household"] if p["id"] == pid)
    assert person["grossIncome"] == 118500


def test_income_is_optional_and_omitted_when_unset(client):
    body = _create(client).json()
    assert "grossIncome" not in body, "unset income must be absent, not 0 — they mean different things"
    person = next(p for p in client.get("/api/data").json()["household"] if p["id"] == body["id"])
    assert "grossIncome" not in person


def test_update_sets_changes_and_clears_income(client):
    pid = _create(client).json()["id"]
    assert client.put(f"/api/people/{pid}", json={"grossIncome": 90000}).json()["grossIncome"] == 90000
    assert client.put(f"/api/people/{pid}", json={"grossIncome": 101000}).json()["grossIncome"] == 101000
    # zero is a real answer (a stay-at-home parent), not a clear
    assert client.put(f"/api/people/{pid}", json={"grossIncome": 0}).json()["grossIncome"] == 0
    # explicit null clears it back to "not recorded"
    assert "grossIncome" not in client.put(f"/api/people/{pid}", json={"grossIncome": None}).json()


def test_update_without_income_key_leaves_it_alone(client):
    pid = _create(client, grossIncome=75000).json()["id"]
    r = client.put(f"/api/people/{pid}", json={"name": "Avery R."})
    assert r.json()["name"] == "Avery R."
    assert r.json()["grossIncome"] == 75000


def test_negative_income_rejected(client):
    assert _create(client, grossIncome=-1).status_code == 422
    pid = _create(client, name="Jordan").json()["id"]
    assert client.put(f"/api/people/{pid}", json={"grossIncome": -5}).status_code == 422


def test_children_can_be_added_and_carry_no_income(client):
    r = client.post("/api/people", json={"name": "Rowan", "role": "child", "birthYear": 2017})
    assert r.status_code == 201
    assert r.json()["role"] == "child"
    assert r.json()["birthYear"] == 2017
    assert "grossIncome" not in r.json()
    kids = [p for p in client.get("/api/data").json()["household"] if p["role"] == "child"]
    assert [k["name"] for k in kids] == ["Rowan"]


def test_role_is_editable_so_a_csv_imported_person_can_be_corrected(client):
    """The investments CSV importer creates everyone as an adult; a child imported that
    way must be fixable, otherwise CESG can never track them."""
    pid = _create(client, name="Rowan").json()["id"]
    r = client.put(f"/api/people/{pid}", json={"role": "child", "birthYear": 2019})
    assert r.status_code == 200
    assert r.json()["role"] == "child"
    assert r.json()["birthYear"] == 2019


def test_birth_year_can_be_cleared(client):
    """The inline Household editor lets you blank the field, so an explicit null has to
    clear it — otherwise a wrong year (e.g. from a CSV import) can never be removed."""
    pid = _create(client, birthYear=1986).json()["id"]
    assert client.put(f"/api/people/{pid}", json={"birthYear": None}).status_code == 200
    assert "birthYear" not in client.get("/api/people").json()[0]


def test_birth_year_untouched_when_key_absent(client):
    pid = _create(client, birthYear=1986).json()["id"]
    r = client.put(f"/api/people/{pid}", json={"name": "Avery R."})
    assert r.json()["birthYear"] == 1986
