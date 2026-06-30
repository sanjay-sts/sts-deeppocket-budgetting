from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_kind
from ..models import Account, InvestmentSnapshot, Contribution
from ..schemas import AccountCreate, AccountUpdate
from ..services.fixtures import _account_out

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _natural_key_exists(session, person_id, institution, account_type, exclude_id=None):
    q = select(Account).where(
        Account.person_id == person_id,
        Account.institution == institution,
        Account.account_type == account_type,
    )
    row = session.exec(q).first()
    return row is not None and row.id != exclude_id


@router.get("")
def list_accounts(session: Session = Depends(get_session)):
    return [_account_out(a) for a in session.exec(select(Account)).all()]


@router.post("", status_code=201)
def create_account(body: AccountCreate, session: Session = Depends(get_session)):
    if _natural_key_exists(session, body.personId, body.institution, body.accountType):
        raise HTTPException(409, "An account with this person, institution, and type already exists.")
    kind = body.kind or normalize_kind(body.accountType)
    name = body.name or f"{body.institution} {body.accountType}"
    a = Account(
        id=new_id("acc"), person_id=body.personId, institution=body.institution,
        account_type=body.accountType, kind=kind, name=name,
        is_liability=body.isLiability, beneficiary_person_id=body.beneficiaryId,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return _account_out(a)


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
    if body.beneficiaryId is not None:
        a.beneficiary_person_id = body.beneficiaryId
    if _natural_key_exists(session, a.person_id, a.institution, a.account_type, exclude_id=a.id):
        raise HTTPException(409, "Another account already has this person, institution, and type.")
    session.add(a)
    session.commit()
    session.refresh(a)
    return _account_out(a)


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: str, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    has_snap = session.exec(
        select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == account_id)).first()
    has_contrib = session.exec(
        select(Contribution).where(Contribution.account_id == account_id)).first()
    if has_snap or has_contrib:
        raise HTTPException(409, "Cannot delete an account that still has snapshots or contributions.")
    session.delete(a)
    session.commit()
