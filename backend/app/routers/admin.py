from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..constants import INVESTMENT_KINDS
from ..db import get_session
from ..models import (
    Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution, Person,
    Category, Transaction, Rule, BudgetLine, BudgetConfig, AppMeta,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class PurgeRequest(BaseModel):
    mode: Literal["investments", "all", "demo"]


def _delete_all(session: Session, model) -> None:
    for row in session.exec(select(model)).all():
        session.delete(row)


def _purge_investments(session: Session) -> None:
    # Bank accounts now share the account table — delete only investment-kind accounts
    # and their dependents (child -> parent order).
    _delete_all(session, Contribution)
    _delete_all(session, InvestmentSnapshot)
    inv_ids = {a.id for a in session.exec(select(Account)).all() if a.kind in INVESTMENT_KINDS}
    for model in (AccountBeneficiary, AccountOwner):
        for row in session.exec(select(model)).all():
            if row.account_id in inv_ids:
                session.delete(row)
    for aid in inv_ids:
        session.delete(session.get(Account, aid))


def _purge_banking(session: Session) -> None:
    # Child -> parent: transactions and budget lines reference categories/accounts.
    for model in (Transaction, Rule, BudgetLine, BudgetConfig, AppMeta):
        _delete_all(session, model)
    for model in (AccountBeneficiary, AccountOwner, Account):
        _delete_all(session, model)
    _delete_all(session, Category)


@router.post("/purge")
def purge(body: PurgeRequest, session: Session = Depends(get_session)) -> dict:
    mode = body.mode
    _purge_investments(session)
    if mode in ("all", "demo"):
        _purge_banking(session)
        _delete_all(session, Person)
    session.commit()

    if mode == "demo":
        # Reseed the full demo dataset. Importable because uvicorn/pytest run from backend/.
        from seed import seed
        seed(session, investments="demo")

    return {"mode": mode, "ok": True}
