import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Account, Category, Transaction
from ..schemas import (
    TransactionBulkDelete,
    TransactionBulkUpdate,
    TransactionCreate,
    TransactionPatch,
)
from ..services.categorize import categorize
from ..services.fixtures import _transaction_out

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _check_date(date: str) -> None:
    if not ISO_DATE.fullmatch(date):
        raise HTTPException(status_code=422, detail=f"Date must be YYYY-MM-DD, got {date!r}")


@router.post("")
def create_transaction(body: TransactionCreate, session: Session = Depends(get_session)) -> dict:
    if not session.get(Account, body.accountId):
        raise HTTPException(status_code=404, detail=f"Unknown account: {body.accountId}")
    _check_date(body.date)
    merchant = body.merchant.strip()
    if not merchant:
        raise HTTPException(status_code=422, detail="Merchant must not be empty")
    if body.amount == 0:
        raise HTTPException(status_code=422, detail="Amount must not be zero")
    if body.categoryId is not None:
        if not session.get(Category, body.categoryId):
            raise HTTPException(status_code=422, detail=f"Unknown category: {body.categoryId}")
        category_id = body.categoryId
    else:
        category_id, _ = categorize(session, merchant, merchant)

    tx = Transaction(
        id=f"txn_m_{uuid.uuid4().hex[:12]}",
        account_id=body.accountId, date=body.date,
        raw_merchant=merchant, merchant=merchant,
        amount=body.amount, category_id=category_id,
        source="manual",
        notes=body.notes or None,
        tags=json.dumps(body.tags) if body.tags else None,
    )
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)


@router.post("/bulk")
def bulk_update(body: TransactionBulkUpdate, session: Session = Depends(get_session)) -> dict:
    if not body.ids:
        raise HTTPException(status_code=422, detail="No transaction ids provided")
    # Category/flags are editable on any row (only date/merchant/amount/account are locked
    # on bank rows), so bulk update never touches immutable facts.
    if body.categoryId is not None and not session.get(Category, body.categoryId):
        raise HTTPException(status_code=422, detail=f"Unknown category: {body.categoryId}")
    updated = 0
    not_found: list[str] = []
    for tid in body.ids:
        tx = session.get(Transaction, tid)
        if not tx:
            not_found.append(tid)
            continue
        if body.categoryId is not None:
            tx.category_id = body.categoryId
        if body.isTransfer is not None:
            tx.is_transfer = body.isTransfer
        if body.isDuplicate is not None:
            tx.is_duplicate = body.isDuplicate
        session.add(tx)
        updated += 1
    session.commit()
    return {"updated": updated, "notFound": not_found}


@router.post("/bulk-delete")
def bulk_delete(body: TransactionBulkDelete, session: Session = Depends(get_session)) -> dict:
    deleted = 0
    skipped_non_manual: list[str] = []
    not_found: list[str] = []
    for tid in body.ids:
        tx = session.get(Transaction, tid)
        if not tx:
            not_found.append(tid)
            continue
        if tx.source != "manual":
            skipped_non_manual.append(tid)
            continue
        session.delete(tx)
        deleted += 1
    session.commit()
    return {"deleted": deleted, "skippedNonManual": skipped_non_manual, "notFound": not_found}


@router.patch("/{tx_id}")
def patch_transaction(
    tx_id: str, body: TransactionPatch, session: Session = Depends(get_session)
) -> dict:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    fact_touched = any(v is not None for v in (body.date, body.merchant, body.amount, body.accountId))
    if fact_touched and tx.source != "manual":
        raise HTTPException(
            status_code=422,
            detail="Bank-imported facts (date/merchant/amount/account) are immutable",
        )

    if body.categoryId is not None:
        if not session.get(Category, body.categoryId):
            raise HTTPException(status_code=422, detail=f"Unknown category: {body.categoryId}")
        tx.category_id = body.categoryId
    if body.isTransfer is not None:
        tx.is_transfer = body.isTransfer
    if body.isDuplicate is not None:
        tx.is_duplicate = body.isDuplicate
    if body.notes is not None:
        tx.notes = body.notes or None
    if body.tags is not None:
        tx.tags = json.dumps(body.tags) if body.tags else None

    if body.date is not None:
        _check_date(body.date)
        tx.date = body.date
    if body.merchant is not None:
        merchant = body.merchant.strip()
        if not merchant:
            raise HTTPException(status_code=422, detail="Merchant must not be empty")
        tx.merchant = merchant
        tx.raw_merchant = merchant
    if body.amount is not None:
        if body.amount == 0:
            raise HTTPException(status_code=422, detail="Amount must not be zero")
        tx.amount = body.amount
    if body.accountId is not None:
        if not session.get(Account, body.accountId):
            raise HTTPException(status_code=422, detail=f"Unknown account: {body.accountId}")
        tx.account_id = body.accountId

    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(tx_id: str, session: Session = Depends(get_session)) -> None:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.source != "manual":
        raise HTTPException(status_code=422, detail="Bank-imported transactions cannot be deleted")
    session.delete(tx)
    session.commit()
