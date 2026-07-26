import json
from sqlmodel import Session, select

from ..constants import BANK_KINDS, CRA_LIMITS_2025
from ..models import (
    Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution,
    StatedRoom, Category, Transaction, BudgetLine, BudgetConfig, AppMeta,
)
from .cesg import derive_cesg_grants


def _person_out(p: Person) -> dict:
    out = {"id": p.id, "name": p.name, "role": p.role}
    if p.birth_year is not None:
        out["birthYear"] = p.birth_year
    return out


def _account_out(
    a: Account, owner_ids: list[str], beneficiary_ids: list[str], owner_names: list[str]
) -> dict:
    # Display name is computed on every read: a custom name always wins, otherwise it's
    # the owners (comma-joined, sorted alphabetically) + institution + account type. Empty
    # parts are dropped so a nameless owner set / blank institution never leaves gaps.
    display = a.custom_name or " ".join(
        x for x in [", ".join(owner_names), a.institution, a.account_type] if x
    ).strip()
    out = {
        "id": a.id,
        "name": display,
        "kind": a.kind,
        "institution": a.institution,
        "accountType": a.account_type,
        "ownerIds": owner_ids,
    }
    if a.custom_name:
        out["customName"] = a.custom_name
    if beneficiary_ids:
        out["beneficiaryIds"] = beneficiary_ids
    if a.is_liability:
        out["isLiability"] = True
    return out


def _contribution_out(c: Contribution) -> dict:
    out = {
        "id": c.id,
        "date": c.date,
        "accountId": c.account_id,
        "personId": c.person_id,
        "amount": c.amount,
        "kind": c.kind,
    }
    if c.beneficiary_person_id:
        out["beneficiaryId"] = c.beneficiary_person_id
    return out


def _stated_room_out(r: StatedRoom) -> dict:
    return {"personId": r.person_id, "kind": r.kind, "amount": r.amount}


def _category_out(c: Category) -> dict:
    out = {"id": c.id, "name": c.name, "group": c.group}
    if c.bucket503020:
        out["bucket503020"] = c.bucket503020
    if c.is_essential:
        out["isEssential"] = True
    return out


def _transaction_out(t: Transaction) -> dict:
    out = {
        "id": t.id, "date": t.date, "accountId": t.account_id,
        "rawMerchant": t.raw_merchant, "merchant": t.merchant,
        "amount": t.amount, "categoryId": t.category_id,
    }
    out["source"] = t.source
    if t.person_id:
        out["personId"] = t.person_id
    if t.is_transfer:
        out["isTransfer"] = True
    if t.is_duplicate:
        out["isDuplicate"] = True
    if t.notes:
        out["notes"] = t.notes
    if t.tags:
        out["tags"] = json.loads(t.tags)
    if t.running_total is not None:
        out["runningTotal"] = t.running_total
    return out


def build_payload(session: Session) -> dict:
    people = session.exec(select(Person)).all()
    accounts = session.exec(select(Account)).all()
    snapshots = session.exec(select(InvestmentSnapshot)).all()
    contributions = session.exec(select(Contribution)).all()
    categories = session.exec(select(Category)).all()
    transactions = session.exec(select(Transaction)).all()
    budget_lines = session.exec(select(BudgetLine)).all()
    budget_cfg = session.get(BudgetConfig, 1)
    meta_rows = {m.key: m.value for m in session.exec(select(AppMeta)).all()}

    owners_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountOwner)).all():
        owners_by_account.setdefault(row.account_id, []).append(row.person_id)
    beneficiaries_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountBeneficiary)).all():
        beneficiaries_by_account.setdefault(row.account_id, []).append(row.person_id)

    names_by_id = {p.id: p.name for p in people}
    accounts_out = []
    for a in accounts:
        owner_ids = sorted(owners_by_account.get(a.id, []))
        accounts_out.append(
            _account_out(
                a,
                owner_ids,
                sorted(beneficiaries_by_account.get(a.id, [])),
                sorted(names_by_id.get(pid, pid) for pid in owner_ids),
            )
        )

    grants = derive_cesg_grants(contributions, CRA_LIMITS_2025)

    budget = {
        "mode": budget_cfg.mode if budget_cfg else "envelope",
        "lines": [
            {"categoryId": line.category_id, "monthlyCap": line.monthly_cap, "rollover": line.rollover}
            for line in budget_lines
        ],
    }
    if budget_cfg and budget_cfg.target_savings_rate is not None:
        budget["targetSavingsRate"] = budget_cfg.target_savings_rate

    return {
        "household": [_person_out(p) for p in people],
        "accounts": accounts_out,
        "categories": [_category_out(c) for c in categories],
        "transactions": [
            _transaction_out(t) for t in sorted(transactions, key=lambda t: (t.date, t.id))
        ],
        "investments": [
            {"date": s.date, "accountId": s.account_id, "amount": s.amount}
            for s in snapshots
        ],
        "contributionEvents": [_contribution_out(c) for c in contributions],
        "statedRoom": [_stated_room_out(r) for r in session.exec(select(StatedRoom)).all()],
        "cesgGrants": grants,
        "budget": budget,
        "craLimits": CRA_LIMITS_2025,
        "meta": {
            "generatedAt": meta_rows.get("generatedAt", ""),
            "seed": int(meta_rows.get("seed", "0")),
            "monthsCovered": int(meta_rows.get("monthsCovered", "0")),
            "openingBalances": {
                a.id: a.opening_balance for a in accounts if a.kind in BANK_KINDS
            },
        },
    }
