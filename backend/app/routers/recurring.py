from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_date, CONTRIBUTION_KINDS, RECURRING_FREQUENCIES
from ..models import Contribution, RecurringContribution
from ..schemas import RecurringCreate, RecurringUpdate, MaterializeRequest
from ..services.fixtures import _recurring_out
from ..services.recurring import materialize_recurring

router = APIRouter(prefix="/api/recurring", tags=["recurring"])


@router.get("")
def list_recurring(session: Session = Depends(get_session)):
    return [_recurring_out(s) for s in session.exec(select(RecurringContribution)).all()]


@router.post("", status_code=201)
def create_recurring(body: RecurringCreate, session: Session = Depends(get_session)):
    if body.kind not in CONTRIBUTION_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(CONTRIBUTION_KINDS)}")
    if body.frequency not in RECURRING_FREQUENCIES:
        raise HTTPException(422, f"frequency must be one of {sorted(RECURRING_FREQUENCIES)}")
    if body.amount <= 0:
        raise HTTPException(422, "amount must be > 0")
    if body.kind == "resp" and not body.beneficiaryId:
        raise HTTPException(422, "RESP schedules require a beneficiary.")
    try:
        start = normalize_date(body.startDate)
        end = normalize_date(body.endDate) if body.endDate else None
    except ValueError as e:
        raise HTTPException(422, str(e))
    dup = session.exec(select(RecurringContribution).where(
        RecurringContribution.account_id == body.accountId,
        RecurringContribution.person_id == body.personId,
        RecurringContribution.kind == body.kind,
        RecurringContribution.frequency == body.frequency,
        RecurringContribution.amount == body.amount)).first()
    if dup:
        raise HTTPException(409, "An identical recurring deposit already exists — it would double every occurrence.")
    s = RecurringContribution(
        id=new_id("rec"), account_id=body.accountId, person_id=body.personId,
        kind=body.kind, amount=body.amount, beneficiary_person_id=body.beneficiaryId,
        frequency=body.frequency, start_date=start, end_date=end,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return _recurring_out(s)


@router.put("/{recurring_id}")
def update_recurring(recurring_id: str, body: RecurringUpdate, session: Session = Depends(get_session)):
    s = session.get(RecurringContribution, recurring_id)
    if not s:
        raise HTTPException(404, "Schedule not found")
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(422, "amount must be > 0")
        s.amount = body.amount
    if body.frequency is not None:
        if body.frequency not in RECURRING_FREQUENCIES:
            raise HTTPException(422, f"frequency must be one of {sorted(RECURRING_FREQUENCIES)}")
        s.frequency = body.frequency
    if body.endDate is not None:
        try:
            s.end_date = normalize_date(body.endDate) if body.endDate else None
        except ValueError as e:
            raise HTTPException(422, str(e))
    if body.paused is not None:
        s.paused = body.paused
    session.add(s)
    session.commit()
    session.refresh(s)
    return _recurring_out(s)


@router.delete("/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: str, session: Session = Depends(get_session)):
    s = session.get(RecurringContribution, recurring_id)
    if not s:
        raise HTTPException(404, "Schedule not found")
    # Materialized deposits really happened — keep them, just unlink the schedule.
    for c in session.exec(select(Contribution).where(Contribution.recurring_id == recurring_id)).all():
        c.recurring_id = None
        session.add(c)
    session.delete(s)
    session.commit()


@router.post("/materialize")
def materialize(body: Optional[MaterializeRequest] = None, session: Session = Depends(get_session)):
    raw = (body.today if body else None) or date.today().isoformat()
    try:
        today = normalize_date(raw)
        date.fromisoformat(today)  # normalize_date checks shape, not calendar validity
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"created": materialize_recurring(session, today)}
