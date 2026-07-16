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

    names_by_id = {p.id: p.name for p in people}
    bank_accounts = [a for a in base["accounts"] if a["kind"] in BANK_KINDS]
    db_accounts = []
    for a in accounts:
        owner_ids = sorted(owners_by_account.get(a.id, []))
        db_accounts.append(
            _account_out(
                a,
                owner_ids,
                sorted(beneficiaries_by_account.get(a.id, [])),
                sorted(names_by_id.get(pid, pid) for pid in owner_ids),
            )
        )

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
