from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_kind
from ..models import Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution
from ..schemas import AccountCreate, AccountUpdate
from ..services.fixtures import _account_out

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _account_owner_ids(session: Session, account_id: str) -> list[str]:
    rows = session.exec(select(AccountOwner).where(AccountOwner.account_id == account_id)).all()
    return sorted(r.person_id for r in rows)


def _account_beneficiary_ids(session: Session, account_id: str) -> list[str]:
    rows = session.exec(select(AccountBeneficiary).where(AccountBeneficiary.account_id == account_id)).all()
    return sorted(r.person_id for r in rows)


def _out(session: Session, a: Account) -> dict:
    return _account_out(a, _account_owner_ids(session, a.id), _account_beneficiary_ids(session, a.id))


def _natural_key_exists(
    session: Session, institution: str, account_type: str,
    owner_ids: set[str], beneficiary_ids: set[str], exclude_id: str = None,
) -> bool:
    candidates = session.exec(select(Account).where(
        Account.institution == institution,
        Account.account_type == account_type,
    )).all()
    for row in candidates:
        if row.id == exclude_id:
            continue
        if set(_account_owner_ids(session, row.id)) != owner_ids:
            continue
        if set(_account_beneficiary_ids(session, row.id)) != beneficiary_ids:
            continue
        return True
    return False


@router.get("")
def list_accounts(session: Session = Depends(get_session)):
    return [_out(session, a) for a in session.exec(select(Account)).all()]


@router.post("", status_code=201)
def create_account(body: AccountCreate, session: Session = Depends(get_session)):
    if not body.personIds:
        raise HTTPException(422, "At least one owner is required.")
    owner_ids = set(body.personIds)
    beneficiary_ids = set(body.beneficiaryIds or [])
    if _natural_key_exists(session, body.institution, body.accountType, owner_ids, beneficiary_ids):
        raise HTTPException(
            409, "An account with this institution, type, owner set, and beneficiary set already exists.")
    kind = body.kind or normalize_kind(body.accountType)
    name = body.name or f"{body.institution} {body.accountType}"
    a = Account(
        id=new_id("acc"), institution=body.institution,
        account_type=body.accountType, kind=kind, name=name,
        is_liability=body.isLiability,
    )
    session.add(a)
    for pid in body.personIds:
        session.add(AccountOwner(account_id=a.id, person_id=pid))
    for bid in (body.beneficiaryIds or []):
        session.add(AccountBeneficiary(account_id=a.id, person_id=bid))
    session.commit()
    session.refresh(a)
    return _out(session, a)


@router.put("/{account_id}")
def update_account(account_id: str, body: AccountUpdate, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    if body.institution is not None:
        a.institution = body.institution
    if body.accountType is not None:
        a.account_type = body.accountType
        if body.kind is None:
            a.kind = normalize_kind(body.accountType)
    if body.kind is not None:
        a.kind = body.kind
    if body.name is not None:
        a.name = body.name
    if body.isLiability is not None:
        a.is_liability = body.isLiability

    if body.personIds is not None:
        if not body.personIds:
            raise HTTPException(422, "At least one owner is required.")
        for row in session.exec(select(AccountOwner).where(AccountOwner.account_id == account_id)).all():
            session.delete(row)
        for pid in body.personIds:
            session.add(AccountOwner(account_id=account_id, person_id=pid))

    if body.beneficiaryIds is not None:
        for row in session.exec(select(AccountBeneficiary).where(AccountBeneficiary.account_id == account_id)).all():
            session.delete(row)
        for bid in body.beneficiaryIds:
            session.add(AccountBeneficiary(account_id=account_id, person_id=bid))

    session.flush()
    owner_ids = set(body.personIds) if body.personIds is not None else set(_account_owner_ids(session, account_id))
    beneficiary_ids = (
        set(body.beneficiaryIds) if body.beneficiaryIds is not None
        else set(_account_beneficiary_ids(session, account_id))
    )
    if _natural_key_exists(session, a.institution, a.account_type, owner_ids, beneficiary_ids, exclude_id=a.id):
        raise HTTPException(
            409, "An account with this institution, type, owner set, and beneficiary set already exists.")

    session.add(a)
    session.commit()
    session.refresh(a)
    return _out(session, a)


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: str, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    snapshot_count = len(session.exec(
        select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == account_id)).all())
    contribution_count = len(session.exec(
        select(Contribution).where(Contribution.account_id == account_id)).all())
    if snapshot_count or contribution_count:
        raise HTTPException(409, detail={
            "message": "This account still has dependent data. Remove it first.",
            "snapshotCount": snapshot_count,
            "contributionCount": contribution_count,
        })
    session.delete(a)
    session.commit()
