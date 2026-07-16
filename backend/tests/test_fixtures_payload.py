import json
from app.models import Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution
from app.services.fixtures import build_payload
from app.config import FIXTURES_PATH

import app.services.fixtures as fixtures_service
from seed import seed


EXPECTED_KEYS = {
    "household", "accounts", "categories", "transactions", "investments",
    "contributionEvents", "cesgGrants", "budget", "craLimits", "meta",
}


def test_payload_is_composed_entirely_from_db(session, monkeypatch):
    seed(session)
    # The fixtures file must not be touched at request time.
    monkeypatch.setattr(
        fixtures_service, "_load_base",
        lambda: (_ for _ in ()).throw(AssertionError("fixtures file read at request time")),
        raising=False,
    )
    payload = build_payload(session)
    assert set(payload.keys()) == EXPECTED_KEYS
    assert len(payload["transactions"]) == 864
    assert payload["craLimits"]["TFSA_ANNUAL"] == 7000
    assert payload["meta"]["openingBalances"]["sanjay_chequing"] == 14500.0
    assert payload["meta"]["seed"] == 42
    assert payload["budget"]["mode"] == "envelope"
    tx = next(t for t in payload["transactions"] if t["id"] == "t1")
    assert tx == {
        "id": "t1", "date": "2025-05-15", "accountId": "sanjay_chequing",
        "rawMerchant": "PAYROLL DEP NUTRIEN", "merchant": "Payroll Dep Nutrien",
        "amount": 4666.73, "categoryId": "salary", "personId": "sanjay",
        "runningTotal": 16015.09,
    }


def test_payload_accounts_include_bank_and_investment(session):
    seed(session)
    payload = build_payload(session)
    kinds = {a["kind"] for a in payload["accounts"]}
    assert "chequing" in kinds and "credit_card" in kinds
    chequing = next(a for a in payload["accounts"] if a["id"] == "sanjay_chequing")
    assert chequing["name"] == "TD Chequing (Sanjay)"
    visa = next(a for a in payload["accounts"] if a["id"] == "sanjay_td_visa")
    assert visa["isLiability"] is True


def test_payload_has_all_fixture_keys(session):
    payload = build_payload(session)
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert set(payload.keys()) == set(base.keys())


def test_household_comes_from_db(session):
    session.add(Person(id="p9", name="Tester", role="adult", birth_year=1990))
    session.commit()
    payload = build_payload(session)
    assert {"id": "p9", "name": "Tester", "role": "adult", "birthYear": 1990} in payload["household"]


def test_investment_and_bank_accounts_both_from_db(session):
    seed(session)
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", institution="Questrade",
                        account_type="tfsa", kind="tfsa"))
    session.add(AccountOwner(account_id="x1", person_id="p1"))
    session.commit()
    payload = build_payload(session)
    kinds = {a["kind"] for a in payload["accounts"]}
    # the db tfsa account is present with a computed owner+institution+type name...
    assert any(a["id"] == "x1" and a["ownerIds"] == ["p1"] and a["accountType"] == "tfsa"
               and a["name"] == "Sanjay Questrade tfsa" and "customName" not in a
               for a in payload["accounts"])
    # ...and bank kinds now come from the DB too (seeded from the fixture file, never
    # read at request time)
    assert "chequing" in kinds or "savings" in kinds or "credit_card" in kinds


def test_snapshots_are_id_less(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", institution="Q", account_type="tfsa",
                        kind="tfsa"))
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
                        kind="resp"))
    session.add(AccountOwner(account_id="x1", person_id="p1"))
    session.add(AccountBeneficiary(account_id="x1", person_id="k1"))
    session.add(Contribution(id="c1", account_id="x1", person_id="p1", date="2025-02-01",
                             amount=1000.0, kind="resp", beneficiary_person_id="k1"))
    session.commit()
    payload = build_payload(session)
    assert any(g["beneficiaryId"] == "k1" and g["amount"] == 200.0 for g in payload["cesgGrants"])
