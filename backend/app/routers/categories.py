import re

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import BudgetLine, Category, Rule, Transaction
from ..schemas import CategoryCreate, CategoryPatch
from ..services.categorize import UNCLASSIFIED
from ..services.fixtures import _category_out

router = APIRouter(prefix="/api/categories", tags=["categories"])

VALID_GROUPS = {"essentials", "lifestyle", "family", "financial", "transfers", "income"}
VALID_BUCKETS = {"needs", "wants", "savings"}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def _check_name_clash(session: Session, name: str, exclude_id: str | None = None) -> None:
    clash = next(
        (c for c in session.exec(select(Category)).all()
         if c.name.lower() == name.lower() and c.id != exclude_id),
        None,
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"A category named {name!r} already exists")


def _check_group(group: str) -> None:
    if group not in VALID_GROUPS:
        raise HTTPException(status_code=422, detail=f"Unknown group: {group}")


def _check_bucket(bucket: str) -> None:
    if bucket and bucket not in VALID_BUCKETS:
        raise HTTPException(status_code=422, detail=f"Unknown 50/30/20 bucket: {bucket}")


@router.post("")
def create_category(body: CategoryCreate, session: Session = Depends(get_session)) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    _check_group(body.group)
    if body.bucket503020 is not None:
        _check_bucket(body.bucket503020)
    cat_id = _slug(name)
    if not cat_id:
        raise HTTPException(status_code=422, detail="Name must contain letters or digits")
    _check_name_clash(session, name)
    if session.get(Category, cat_id):
        raise HTTPException(status_code=409, detail=f"A category with id {cat_id!r} already exists")
    cat = Category(
        id=cat_id, name=name, group=body.group,
        bucket503020=body.bucket503020 or None, is_essential=body.isEssential,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return _category_out(cat)


@router.patch("/{cat_id}")
def patch_category(cat_id: str, body: CategoryPatch, session: Session = Depends(get_session)) -> dict:
    if cat_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be edited")
    cat = session.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name must not be empty")
        _check_name_clash(session, name, exclude_id=cat_id)
        cat.name = name
    if body.group is not None:
        _check_group(body.group)
        cat.group = body.group
    if body.bucket503020 is not None:
        _check_bucket(body.bucket503020)
        cat.bucket503020 = body.bucket503020 or None
    if body.isEssential is not None:
        cat.is_essential = body.isEssential
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return _category_out(cat)


@router.delete("/{cat_id}")
def delete_category(cat_id: str, session: Session = Depends(get_session)) -> dict:
    if cat_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be deleted")
    cat = session.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    txs = session.exec(select(Transaction).where(Transaction.category_id == cat_id)).all()
    for t in txs:
        t.category_id = UNCLASSIFIED
        session.add(t)
    rules = session.exec(select(Rule).where(Rule.category_id == cat_id)).all()
    for r in rules:
        session.delete(r)
    line = session.get(BudgetLine, cat_id)
    if line:
        session.delete(line)
    session.delete(cat)
    session.commit()
    return {
        "deleted": True,
        "transactionsReassigned": len(txs),
        "rulesDeleted": len(rules),
        "budgetLineDeleted": line is not None,
    }
