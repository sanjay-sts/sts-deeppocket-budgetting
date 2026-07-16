"""Derive CESG grants from RESP contributions.

CESG = 20% of each RESP contribution, capped at CESG_ANNUAL_PER_CHILD per child per
calendar year and CESG_LIFETIME_PER_CHILD per child for life. Grants are derived on
every read so they can never drift from the contributions they depend on.
"""
from typing import Iterable


def derive_cesg_grants(contributions: Iterable, limits: dict) -> list[dict]:
    rate = limits["CESG_RATE"]
    annual_cap = limits["CESG_ANNUAL_PER_CHILD"]
    lifetime_cap = limits["CESG_LIFETIME_PER_CHILD"]

    resp = [
        c for c in contributions
        if c.kind == "resp" and c.beneficiary_person_id
    ]
    resp.sort(key=lambda c: (c.date, c.id))

    per_year: dict[tuple, float] = {}
    lifetime: dict[str, float] = {}
    grants: list[dict] = []

    for c in resp:
        year = c.date[:4]
        kid = c.beneficiary_person_id
        raw = c.amount * rate
        annual_room = max(0.0, annual_cap - per_year.get((kid, year), 0.0))
        lifetime_room = max(0.0, lifetime_cap - lifetime.get(kid, 0.0))
        grant = round(min(raw, annual_room, lifetime_room), 2)
        if grant <= 0:
            continue
        per_year[(kid, year)] = per_year.get((kid, year), 0.0) + grant
        lifetime[kid] = lifetime.get(kid, 0.0) + grant
        grants.append({
            "id": f"cesg_{c.id}",
            "date": c.date,
            "beneficiaryId": kid,
            "contributionEventId": c.id,
            "amount": grant,
            "accountId": c.account_id,
        })
    return grants
