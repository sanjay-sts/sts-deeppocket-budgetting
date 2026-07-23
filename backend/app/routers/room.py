from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, STATED_ROOM_KINDS
from ..models import Person, StatedRoom
from ..schemas import StatedRoomUpsert
from ..services.fixtures import _stated_room_out

router = APIRouter(prefix="/api/room", tags=["room"])


@router.get("")
def list_stated_room(session: Session = Depends(get_session)):
    return [_stated_room_out(r) for r in session.exec(select(StatedRoom)).all()]


@router.put("")
def upsert_stated_room(body: StatedRoomUpsert, session: Session = Depends(get_session)):
    if body.kind not in STATED_ROOM_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(STATED_ROOM_KINDS)}")
    if body.amount < 0:
        raise HTTPException(422, "amount must be >= 0")
    if not session.get(Person, body.personId):
        raise HTTPException(404, "Person not found")
    row = session.exec(select(StatedRoom).where(
        StatedRoom.person_id == body.personId, StatedRoom.kind == body.kind)).first()
    if row:
        row.amount = body.amount
    else:
        row = StatedRoom(id=new_id("room"), person_id=body.personId, kind=body.kind, amount=body.amount)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _stated_room_out(row)


@router.delete("/{person_id}/{kind}", status_code=204)
def delete_stated_room(person_id: str, kind: str, session: Session = Depends(get_session)):
    row = session.exec(select(StatedRoom).where(
        StatedRoom.person_id == person_id, StatedRoom.kind == kind)).first()
    if not row:
        raise HTTPException(404, "Stated room not found")
    session.delete(row)
    session.commit()
