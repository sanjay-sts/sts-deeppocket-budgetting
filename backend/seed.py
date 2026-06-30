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
from app.models import Person, Account, InvestmentSnapshot, Contribution


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
        for model in (Contribution, InvestmentSnapshot, Account):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()
        return

    for a in base["accounts"]:
        if a["kind"] not in INVESTMENT_KINDS:
            continue
        owner = a["ownerIds"][0]
        # account_type seeds from the known kind, but the natural key
        # (person_id, institution, account_type) must stay unique. Two RESP
        # accounts at the same institution for the same owner differ only by
        # beneficiary, so disambiguate account_type with it. account_type is
        # internal (never served) so this affects no payload.
        beneficiary = a.get("beneficiaryId")
        account_type = f"{a['kind']}_{beneficiary}" if beneficiary else a["kind"]
        _upsert(session, Account, a["id"], {
            "person_id": owner,
            "institution": a["institution"],
            "account_type": account_type,   # seed account_type from the known kind
            "kind": a["kind"],
            "name": a["name"],
            "is_liability": a.get("isLiability", False),
            "beneficiary_person_id": a.get("beneficiaryId"),
        })
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
