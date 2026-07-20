from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import BudgetConfig, BudgetLine, Category
from ..schemas import BudgetConfigPatch, BudgetLineUpsert
from ..services.categorize import UNCLASSIFIED

router = APIRouter(prefix="/api/budget", tags=["budget"])

VALID_MODES = {"envelope", "zero_based", "fifty_thirty_twenty"}


def _line_out(line: BudgetLine) -> dict:
    return {"categoryId": line.category_id, "monthlyCap": line.monthly_cap, "rollover": line.rollover}


@router.put("/lines/{category_id}")
def upsert_line(
    category_id: str, body: BudgetLineUpsert, session: Session = Depends(get_session)
) -> dict:
    if category_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be budgeted")
    if not session.get(Category, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    if body.monthlyCap < 0:
        raise HTTPException(status_code=422, detail="monthlyCap must be >= 0")
    line = session.get(BudgetLine, category_id)
    if line:
        line.monthly_cap = body.monthlyCap
        line.rollover = body.rollover
    else:
        line = BudgetLine(category_id=category_id, monthly_cap=body.monthlyCap, rollover=body.rollover)
    session.add(line)
    session.commit()
    session.refresh(line)
    return _line_out(line)


@router.delete("/lines/{category_id}", status_code=204)
def delete_line(category_id: str, session: Session = Depends(get_session)) -> None:
    line = session.get(BudgetLine, category_id)
    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")
    session.delete(line)
    session.commit()


@router.patch("/config")
def patch_config(body: BudgetConfigPatch, session: Session = Depends(get_session)) -> dict:
    cfg = session.get(BudgetConfig, 1) or BudgetConfig(id=1, mode="envelope")
    if body.mode is not None:
        if body.mode not in VALID_MODES:
            raise HTTPException(status_code=422, detail=f"Unknown budget mode: {body.mode}")
        cfg.mode = body.mode
    if body.targetSavingsRate is not None:
        if not 0 <= body.targetSavingsRate <= 1:
            raise HTTPException(status_code=422, detail="targetSavingsRate must be between 0 and 1")
        cfg.target_savings_rate = body.targetSavingsRate
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    out: dict = {"mode": cfg.mode}
    if cfg.target_savings_rate is not None:
        out["targetSavingsRate"] = cfg.target_savings_rate
    return out
