from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_date, CONTRIBUTION_KINDS
from ..models import Contribution
from ..schemas import ContributionCreate, ContributionUpdate
from ..services.fixtures import _contribution_out

router = APIRouter(prefix="/api/contributions", tags=["contributions"])


@router.get("")
def list_contributions(session: Session = Depends(get_session)):
    return [_contribution_out(c) for c in session.exec(select(Contribution)).all()]


@router.post("", status_code=201)
def create_contribution(body: ContributionCreate, session: Session = Depends(get_session)):
    if body.kind not in CONTRIBUTION_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(CONTRIBUTION_KINDS)}")
    if body.kind == "resp" and not body.beneficiaryId:
        raise HTTPException(422, "RESP contributions require a beneficiary.")
    try:
        date = normalize_date(body.date)
    except ValueError as e:
        raise HTTPException(422, str(e))
    c = Contribution(
        id=new_id("contrib"), account_id=body.accountId, person_id=body.personId,
        date=date, amount=body.amount, kind=body.kind,
        beneficiary_person_id=body.beneficiaryId,
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contribution_out(c)


@router.put("/{contribution_id}")
def update_contribution(contribution_id: str, body: ContributionUpdate, session: Session = Depends(get_session)):
    c = session.get(Contribution, contribution_id)
    if not c:
        raise HTTPException(404, "Contribution not found")
    if body.kind is not None:
        if body.kind not in CONTRIBUTION_KINDS:
            raise HTTPException(422, f"kind must be one of {sorted(CONTRIBUTION_KINDS)}")
        c.kind = body.kind
    if body.date is not None:
        try:
            c.date = normalize_date(body.date)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if body.amount is not None:
        c.amount = body.amount
    if body.beneficiaryId is not None:
        c.beneficiary_person_id = body.beneficiaryId
    if c.kind == "resp" and not c.beneficiary_person_id:
        raise HTTPException(422, "RESP contributions require a beneficiary.")
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contribution_out(c)


@router.delete("/{contribution_id}", status_code=204)
def delete_contribution(contribution_id: str, session: Session = Depends(get_session)):
    c = session.get(Contribution, contribution_id)
    if not c:
        raise HTTPException(404, "Contribution not found")
    session.delete(c)
    session.commit()
