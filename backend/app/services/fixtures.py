import json
from sqlmodel import Session, select

from ..config import FIXTURES_PATH
from ..constants import BANK_KINDS
from ..models import Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution
from .cesg import derive_cesg_grants


def _load_base() -> dict:
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def _person_out(p: Person) -> dict:
    out = {"id": p.id, "name": p.name, "role": p.role}
    if p.birth_year is not None:
        out["birthYear"] = p.birth_year
    return out


def _account_out(a: Account, owner_ids: list[str], beneficiary_ids: list[str]) -> dict:
    out = {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "institution": a.institution,
        "accountType": a.account_type,
        "ownerIds": owner_ids,
    }
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


def build_payload(session: Session) -> dict:
    base = _load_base()

    people = session.exec(select(Person)).all()
    accounts = session.exec(select(Account)).all()
    snapshots = session.exec(select(InvestmentSnapshot)).all()
    contributions = session.exec(select(Contribution)).all()

    owners_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountOwner)).all():
        owners_by_account.setdefault(row.account_id, []).append(row.person_id)
    beneficiaries_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountBeneficiary)).all():
        beneficiaries_by_account.setdefault(row.account_id, []).append(row.person_id)

    bank_accounts = [a for a in base["accounts"] if a["kind"] in BANK_KINDS]
    db_accounts = [
        _account_out(
            a,
            sorted(owners_by_account.get(a.id, [])),
            sorted(beneficiaries_by_account.get(a.id, [])),
        )
        for a in accounts
    ]

    grants = derive_cesg_grants(contributions, base["craLimits"])

    return {
        "household": [_person_out(p) for p in people],
        "accounts": bank_accounts + db_accounts,
        "categories": base["categories"],
        "rules": base["rules"],
        "transactions": base["transactions"],
        "investments": [
            {"date": s.date, "accountId": s.account_id, "amount": s.amount}
            for s in snapshots
        ],
        "contributionEvents": [_contribution_out(c) for c in contributions],
        "cesgGrants": grants,
        "budget": base["budget"],
        "craLimits": base["craLimits"],
        "meta": base["meta"],
    }
