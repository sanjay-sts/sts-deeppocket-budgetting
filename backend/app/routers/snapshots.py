from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_date
from ..models import InvestmentSnapshot
from ..schemas import SnapshotUpsert, SnapshotUpdate

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


def _out(s: InvestmentSnapshot) -> dict:
    return {"id": s.id, "accountId": s.account_id, "date": s.date, "amount": s.amount}


@router.get("")
def list_snapshots(account_id: Optional[str] = None, session: Session = Depends(get_session)):
    q = select(InvestmentSnapshot)
    if account_id:
        q = q.where(InvestmentSnapshot.account_id == account_id)
    return [_out(s) for s in session.exec(q).all()]


@router.post("")
def upsert_snapshot(body: SnapshotUpsert, session: Session = Depends(get_session)):
    try:
        date = normalize_date(body.date)
    except ValueError as e:
        raise HTTPException(422, str(e))
    existing = session.exec(select(InvestmentSnapshot).where(
        InvestmentSnapshot.account_id == body.accountId,
        InvestmentSnapshot.date == date,
    )).first()
    if existing:
        existing.amount = body.amount
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return _out(existing)
    s = InvestmentSnapshot(id=new_id("snap"), account_id=body.accountId, date=date, amount=body.amount)
    session.add(s)
    session.commit()
    session.refresh(s)
    return _out(s)


@router.put("/{snapshot_id}")
def update_snapshot(snapshot_id: str, body: SnapshotUpdate, session: Session = Depends(get_session)):
    s = session.get(InvestmentSnapshot, snapshot_id)
    if not s:
        raise HTTPException(404, "Snapshot not found")
    if body.date is not None:
        try:
            s.date = normalize_date(body.date)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if body.amount is not None:
        s.amount = body.amount
    session.add(s)
    session.commit()
    session.refresh(s)
    return _out(s)


@router.delete("/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: str, session: Session = Depends(get_session)):
    s = session.get(InvestmentSnapshot, snapshot_id)
    if not s:
        raise HTTPException(404, "Snapshot not found")
    session.delete(s)
    session.commit()
