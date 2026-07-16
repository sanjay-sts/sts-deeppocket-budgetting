from app.models import Contribution
from app.services.cesg import derive_cesg_grants

LIMITS = {"CESG_RATE": 0.20, "CESG_ANNUAL_PER_CHILD": 500, "CESG_LIFETIME_PER_CHILD": 7200}


def _resp(id, date, amount, beneficiary, account="acc1", person="p1"):
    return Contribution(
        id=id, account_id=account, person_id=person, date=date,
        amount=amount, kind="resp", beneficiary_person_id=beneficiary,
    )


def test_basic_20_percent_grant():
    grants = derive_cesg_grants([_resp("c1", "2025-03-01", 1000, "k1")], LIMITS)
    assert len(grants) == 1
    g = grants[0]
    assert g["amount"] == 200.0
    assert g["beneficiaryId"] == "k1"
    assert g["contributionEventId"] == "c1"
    assert g["accountId"] == "acc1"
    assert g["date"] == "2025-03-01"


def test_annual_cap_500_per_child():
    # 2 * 2000 contributions in one year -> raw grant 400 + 400, capped at 500/yr
    grants = derive_cesg_grants(
        [_resp("c1", "2025-02-01", 2000, "k1"), _resp("c2", "2025-09-01", 2000, "k1")],
        LIMITS,
    )
    assert sum(g["amount"] for g in grants) == 500.0


def test_annual_cap_resets_next_year():
    grants = derive_cesg_grants(
        [_resp("c1", "2025-06-01", 3000, "k1"), _resp("c2", "2026-06-01", 3000, "k1")],
        LIMITS,
    )
    by_year = {}
    for g in grants:
        by_year[g["date"][:4]] = by_year.get(g["date"][:4], 0) + g["amount"]
    assert by_year["2025"] == 500.0
    assert by_year["2026"] == 500.0


def test_lifetime_cap_7200():
    # 20 years of max $2500 (grant $500) = $10000 raw, capped at $7200 lifetime
    events = [_resp(f"c{y}", f"{2000 + y}-06-01", 2500, "k1") for y in range(20)]
    grants = derive_cesg_grants(events, LIMITS)
    assert round(sum(g["amount"] for g in grants), 2) == 7200.0


def test_non_resp_and_unbeneficiaried_ignored():
    rrsp = Contribution(id="c1", account_id="a", person_id="p1", date="2025-01-01",
                        amount=1000, kind="rrsp", beneficiary_person_id=None)
    resp_no_kid = _resp("c2", "2025-01-01", 1000, None)
    assert derive_cesg_grants([rrsp, resp_no_kid], LIMITS) == []


def test_per_child_independent_caps():
    grants = derive_cesg_grants(
        [_resp("c1", "2025-01-01", 3000, "k1"), _resp("c2", "2025-01-01", 3000, "k2")],
        LIMITS,
    )
    by_kid = {}
    for g in grants:
        by_kid[g["beneficiaryId"]] = by_kid.get(g["beneficiaryId"], 0) + g["amount"]
    assert by_kid == {"k1": 500.0, "k2": 500.0}
