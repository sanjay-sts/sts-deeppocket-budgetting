from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlmodel import Session

from ..db import get_session
from ..schemas import TransactionCsvMapping
from ..services.csv_import import import_investment_csv
from ..services.transactions_csv import (
    import_transactions_csv,
    import_transactions_csv_mapped,
    preview_transactions_csv,
)

router = APIRouter(prefix="/api/import", tags=["imports"])


@router.post("/investments-csv")
async def import_investments_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return import_investment_csv(text, session)


@router.post("/transactions-csv")
async def import_transactions_csv_endpoint(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return import_transactions_csv(text, session)


@router.post("/transactions-csv/preview")
async def preview_transactions_csv_endpoint(file: UploadFile = File(...)) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return preview_transactions_csv(text)


@router.post("/transactions-csv/mapped")
async def import_transactions_csv_mapped_endpoint(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    try:
        parsed = TransactionCsvMapping.model_validate_json(mapping)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid mapping: {e}")
    return import_transactions_csv_mapped(text, parsed, session)
