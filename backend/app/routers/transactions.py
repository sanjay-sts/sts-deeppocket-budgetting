import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Category, Transaction
from ..schemas import TransactionPatch
from ..services.fixtures import _transaction_out

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.patch("/{tx_id}")
def patch_transaction(
    tx_id: str, body: TransactionPatch, session: Session = Depends(get_session)
) -> dict:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

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

    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)
