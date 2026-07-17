from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..constants import new_id
from ..db import get_session
from ..models import Category, Rule
from ..schemas import RuleCreate, RuleUpdate

router = APIRouter(prefix="/api/rules", tags=["rules"])


def _rule_out(r: Rule) -> dict:
    return {"id": r.id, "keyword": r.keyword, "categoryId": r.category_id, "createdAt": r.created_at}


def _validate(session: Session, keyword: str | None, category_id: str | None, exclude_id: str | None = None) -> None:
    if keyword is not None:
        if not keyword.strip():
            raise HTTPException(status_code=422, detail="Keyword must not be empty")
        clash = next(
            (r for r in session.exec(select(Rule)).all()
             if r.keyword.lower() == keyword.strip().lower() and r.id != exclude_id),
            None,
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"A rule for {keyword!r} already exists")
    if category_id is not None and not session.get(Category, category_id):
        raise HTTPException(status_code=422, detail=f"Unknown category: {category_id}")


@router.get("")
def list_rules(session: Session = Depends(get_session)) -> list[dict]:
    rules = session.exec(select(Rule)).all()
    return [_rule_out(r) for r in sorted(rules, key=lambda r: r.created_at, reverse=True)]


@router.post("")
def create_rule(body: RuleCreate, session: Session = Depends(get_session)) -> dict:
    _validate(session, body.keyword, body.categoryId)
    rule = Rule(
        id=new_id("rule"), keyword=body.keyword.strip(), category_id=body.categoryId,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _rule_out(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: str, body: RuleUpdate, session: Session = Depends(get_session)) -> dict:
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    _validate(session, body.keyword, body.categoryId, exclude_id=rule_id)
    if body.keyword is not None:
        rule.keyword = body.keyword.strip()
    if body.categoryId is not None:
        rule.category_id = body.categoryId
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: str, session: Session = Depends(get_session)) -> None:
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    session.delete(rule)
    session.commit()
