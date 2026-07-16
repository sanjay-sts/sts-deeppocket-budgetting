"""Idempotent seeder: load M1 mock fixtures into the editable tables.

Usage (from backend/, venv active):
    python seed.py                      # full demo data
    python seed.py --investments=empty  # people only; investment domain starts clean
"""
import argparse
import json

from sqlmodel import Session, select

from app.config import FIXTURES_PATH
from app.constants import INVESTMENT_KINDS, new_id
from app.db import engine, init_db
from app.models import Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution


def _upsert(session: Session, model, pk: str, values: dict):
    existing = session.get(model, pk)
    if existing:
        for k, v in values.items():
            setattr(existing, k, v)
        session.add(existing)
        return existing
    obj = model(id=pk, **values)
    session.add(obj)
    return obj


def seed(session: Session, investments: str = "demo") -> None:
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    # People are always seeded (the household is real even in 'empty' mode).
    for p in base["household"]:
        _upsert(session, Person, p["id"], {
            "name": p["name"], "role": p["role"], "birth_year": p.get("birthYear"),
        })
    session.commit()

    if investments == "empty":
        # Drop any previously-seeded investment domain so it starts clean.
        for model in (Contribution, InvestmentSnapshot, AccountOwner, AccountBeneficiary, Account):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()
        return

    for a in base["accounts"]:
        if a["kind"] not in INVESTMENT_KINDS:
            continue
        _upsert(session, Account, a["id"], {
            "institution": a["institution"],
            "account_type": a["kind"],   # seed account_type from the known kind
            "kind": a["kind"],
            # No stored name: custom_name stays None so the display name is computed.
            "is_liability": a.get("isLiability", False),
        })

        # Owners/beneficiaries: clear and re-insert per account so re-seeding never
        # duplicates join-table rows.
        for row in session.exec(
            select(AccountOwner).where(AccountOwner.account_id == a["id"])
        ).all():
            session.delete(row)
        for owner in a["ownerIds"]:
            session.add(AccountOwner(account_id=a["id"], person_id=owner))

        for row in session.exec(
            select(AccountBeneficiary).where(AccountBeneficiary.account_id == a["id"])
        ).all():
            session.delete(row)
        # Accept either the new plural shape or the legacy singular one, so a raw
        # fixture produced by an older mock generator still seeds correctly.
        beneficiaries = a.get("beneficiaryIds") or ([a["beneficiaryId"]] if a.get("beneficiaryId") else [])
        for beneficiary in beneficiaries:
            session.add(AccountBeneficiary(account_id=a["id"], person_id=beneficiary))
    session.commit()

    # Snapshots are keyed by (account_id, date); re-seeding overwrites, never duplicates.
    existing_snap = {
        (s.account_id, s.date): s
        for s in session.exec(select(InvestmentSnapshot)).all()
    }
    for s in base["investments"]:
        key = (s["accountId"], s["date"])
        if key in existing_snap:
            existing_snap[key].amount = s["amount"]
            session.add(existing_snap[key])
        else:
            session.add(InvestmentSnapshot(
                id=new_id("snap"), account_id=s["accountId"],
                date=s["date"], amount=s["amount"],
            ))
    session.commit()

    existing_contrib_ids = {c.id for c in session.exec(select(Contribution)).all()}
    for c in base["contributionEvents"]:
        if c["id"] in existing_contrib_ids:
            continue
        session.add(Contribution(
            id=c["id"], account_id=c["accountId"], person_id=c["personId"],
            date=c["date"], amount=c["amount"], kind=c["kind"],
            beneficiary_person_id=c.get("beneficiaryId"),
        ))
    session.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--investments", choices=["demo", "empty"], default="demo")
    args = parser.parse_args()
    init_db()
    with Session(engine) as session:
        seed(session, investments=args.investments)
    print(f"Seeded (investments={args.investments}).")


if __name__ == "__main__":
    main()
