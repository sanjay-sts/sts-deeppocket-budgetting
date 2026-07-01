import json
from app.models import Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution
from app.services.fixtures import build_payload
from app.config import FIXTURES_PATH


def test_payload_has_all_fixture_keys(session):
    payload = build_payload(session)
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert set(payload.keys()) == set(base.keys())


def test_household_comes_from_db(session):
    session.add(Person(id="p9", name="Tester", role="adult", birth_year=1990))
    session.commit()
    payload = build_payload(session)
    assert {"id": "p9", "name": "Tester", "role": "adult", "birthYear": 1990} in payload["household"]


def test_investment_accounts_from_db_banks_from_file(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", institution="Questrade",
                        account_type="tfsa", kind="tfsa", name="Questrade TFSA"))
    session.add(AccountOwner(account_id="x1", person_id="p1"))
    session.commit()
    payload = build_payload(session)
    kinds = {a["kind"] for a in payload["accounts"]}
    # the db tfsa account is present...
    assert any(a["id"] == "x1" and a["ownerIds"] == ["p1"] and a["accountType"] == "tfsa"
               for a in payload["accounts"])
    # ...and bank kinds still come through from the read-only file
    assert "chequing" in kinds or "savings" in kinds or "credit_card" in kinds


def test_snapshots_are_id_less(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", institution="Q", account_type="tfsa",
                        kind="tfsa", name="Q TFSA"))
    session.add(AccountOwner(account_id="x1", person_id="p1"))
    session.add(InvestmentSnapshot(id="s1", account_id="x1", date="2025-01-31", amount=100.0))
    session.commit()
    payload = build_payload(session)
    assert {"date": "2025-01-31", "accountId": "x1", "amount": 100.0} in payload["investments"]
    assert all("id" not in snap for snap in payload["investments"])


def test_cesg_grants_derived_from_contributions(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Person(id="k1", name="Kiran", role="child"))
    session.add(Account(id="x1", institution="WS", account_type="resp",
                        kind="resp", name="WS RESP"))
    session.add(AccountOwner(account_id="x1", person_id="p1"))
    session.add(AccountBeneficiary(account_id="x1", person_id="k1"))
    session.add(Contribution(id="c1", account_id="x1", person_id="p1", date="2025-02-01",
                             amount=1000.0, kind="resp", beneficiary_person_id="k1"))
    session.commit()
    payload = build_payload(session)
    assert any(g["beneficiaryId"] == "k1" and g["amount"] == 200.0 for g in payload["cesgGrants"])
