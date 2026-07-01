from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id
from ..models import Person, AccountOwner, AccountBeneficiary, Contribution
from ..schemas import PersonCreate, PersonUpdate
from ..services.fixtures import _person_out

router = APIRouter(prefix="/api/people", tags=["people"])


@router.get("")
def list_people(session: Session = Depends(get_session)):
    return [_person_out(p) for p in session.exec(select(Person)).all()]


@router.post("", status_code=201)
def create_person(body: PersonCreate, session: Session = Depends(get_session)):
    p = Person(id=new_id("p"), name=body.name, role=body.role, birth_year=body.birthYear)
    session.add(p)
    session.commit()
    session.refresh(p)
    return _person_out(p)


@router.put("/{person_id}")
def update_person(person_id: str, body: PersonUpdate, session: Session = Depends(get_session)):
    p = session.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if body.name is not None:
        p.name = body.name
    if body.role is not None:
        p.role = body.role
    if body.birthYear is not None:
        p.birth_year = body.birthYear
    session.add(p)
    session.commit()
    session.refresh(p)
    return _person_out(p)


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: str, session: Session = Depends(get_session)):
    p = session.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    owned_count = len(session.exec(select(AccountOwner).where(AccountOwner.person_id == person_id)).all())
    beneficiary_count = len(
        session.exec(select(AccountBeneficiary).where(AccountBeneficiary.person_id == person_id)).all())
    contribution_count = len(session.exec(select(Contribution).where(Contribution.person_id == person_id)).all())
    if owned_count or beneficiary_count or contribution_count:
        raise HTTPException(409, detail={
            "message": "This person still has dependent data. Remove it first.",
            "ownedAccountCount": owned_count,
            "beneficiaryAccountCount": beneficiary_count,
            "contributionCount": contribution_count,
        })
    session.delete(p)
    session.commit()
