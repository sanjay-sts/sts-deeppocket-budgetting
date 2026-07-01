from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution, Person

router = APIRouter(prefix="/api/admin", tags=["admin"])


class PurgeRequest(BaseModel):
    mode: Literal["investments", "all", "demo"]


def _delete_all(session: Session, model) -> None:
    for row in session.exec(select(model)).all():
        session.delete(row)


def _purge_investments(session: Session) -> None:
    # Child -> parent order: contributions/snapshots and join rows before accounts.
    for model in (Contribution, InvestmentSnapshot, AccountBeneficiary, AccountOwner, Account):
        _delete_all(session, model)


@router.post("/purge")
def purge(body: PurgeRequest, session: Session = Depends(get_session)) -> dict:
    mode = body.mode
    _purge_investments(session)
    if mode in ("all", "demo"):
        _delete_all(session, Person)
    session.commit()

    if mode == "demo":
        # Reseed the demo household + investment domain. Importable because uvicorn/pytest
        # run from backend/.
        from seed import seed
        seed(session, investments="demo")

    return {"mode": mode, "ok": True}
