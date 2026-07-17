"""Idempotent seeder: load M1 mock fixtures into the editable tables.

Usage (from backend/, venv active):
    python seed.py                      # full demo data
    python seed.py --investments=empty  # people only; investment domain starts clean
"""
import argparse
import json

from sqlmodel import Session, select

from app.config import FIXTURES_PATH
from app.constants import BANK_KINDS, INVESTMENT_KINDS, new_id
from app.db import engine, init_db
from app.models import (
    Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution,
    Category, Transaction, BudgetLine, BudgetConfig, AppMeta,
)


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
        # Drop only the investment domain; banking data (accounts in BANK_KINDS and
        # their transactions) is not part of the 'empty investments' story.
        for model in (Contribution, InvestmentSnapshot):
            for row in session.exec(select(model)).all():
                session.delete(row)
        inv_ids = {a.id for a in session.exec(select(Account)).all() if a.kind in INVESTMENT_KINDS}
        for model in (AccountOwner, AccountBeneficiary):
            for row in session.exec(select(model)).all():
                if row.account_id in inv_ids:
                    session.delete(row)
        for aid in inv_ids:
            session.delete(session.get(Account, aid))
        session.commit()
        _seed_banking(session, base)
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

    _seed_banking(session, base)


def _seed_banking(session: Session, base: dict) -> None:
    """Seed categories, bank accounts, transactions, budget, and app meta. Idempotent:
    every row is upserted by its fixture id / natural pk."""
    for c in base["categories"]:
        _upsert(session, Category, c["id"], {
            "name": c["name"], "group": c["group"],
            "bucket503020": c.get("bucket503020"),
            "is_essential": c.get("isEssential", False),
        })
    session.commit()

    opening = base["meta"].get("openingBalances", {})
    for a in base["accounts"]:
        if a["kind"] not in BANK_KINDS:
            continue
        _upsert(session, Account, a["id"], {
            "institution": a["institution"],
            "account_type": a["kind"],
            "kind": a["kind"],
            # Preserve the fixture display name exactly (screens keep rendering
            # "TD Chequing (Sanjay)", not the computed owners+institution+type form).
            "custom_name": a["name"],
            "is_liability": a.get("isLiability", False),
            "opening_balance": opening.get(a["id"], 0.0),
        })
        for row in session.exec(
            select(AccountOwner).where(AccountOwner.account_id == a["id"])
        ).all():
            session.delete(row)
        for owner in a["ownerIds"]:
            session.add(AccountOwner(account_id=a["id"], person_id=owner))
    session.commit()

    # Cash wallet for manual (cash) transactions — always present, $0 opening,
    # owned by the adults. custom_name pins the display name to just "Cash".
    _upsert(session, Account, "cash_wallet", {
        "institution": "Cash",
        "account_type": "cash",
        "kind": "cash",
        "custom_name": "Cash",
        "is_liability": False,
        "opening_balance": 0.0,
    })
    for row in session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "cash_wallet")
    ).all():
        session.delete(row)
    for p in base["household"]:
        if p["role"] == "adult":
            session.add(AccountOwner(account_id="cash_wallet", person_id=p["id"]))
    session.commit()

    for t in base["transactions"]:
        _upsert(session, Transaction, t["id"], {
            "account_id": t["accountId"], "date": t["date"],
            "raw_merchant": t["rawMerchant"], "merchant": t["merchant"],
            "amount": t["amount"], "category_id": t["categoryId"],
            "person_id": t.get("personId"),
            "is_transfer": t.get("isTransfer", False),
            "is_duplicate": t.get("isDuplicate", False),
            "notes": t.get("notes"),
            "tags": json.dumps(t["tags"]) if t.get("tags") else None,
            "running_total": t.get("runningTotal"),
        })
    session.commit()

    for line in base["budget"]["lines"]:
        existing = session.get(BudgetLine, line["categoryId"])
        if existing:
            existing.monthly_cap = line["monthlyCap"]
            existing.rollover = line["rollover"]
            session.add(existing)
        else:
            session.add(BudgetLine(
                category_id=line["categoryId"],
                monthly_cap=line["monthlyCap"], rollover=line["rollover"],
            ))
    cfg = session.get(BudgetConfig, 1) or BudgetConfig(id=1, mode=base["budget"]["mode"])
    cfg.mode = base["budget"]["mode"]
    cfg.target_savings_rate = base["budget"].get("targetSavingsRate")
    session.add(cfg)

    for key in ("generatedAt", "seed", "monthsCovered"):
        meta_row = session.get(AppMeta, key) or AppMeta(key=key, value="")
        meta_row.value = str(base["meta"][key])
        session.add(meta_row)
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
