import csv

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlmodel import Session

from ..db import get_session
from ..schemas import TransactionCsvMapping
from ..services.csv_import import import_investment_csv
from ..services.uploads import decode_upload
from ..services.transactions_csv import (
    import_transactions_csv,
    import_transactions_csv_mapped,
    preview_transactions_csv,
)

router = APIRouter(prefix="/api/import", tags=["imports"])


def _parse(fn, *args):
    """Run a CSV importer, turning a malformed-CSV blow-up into a 400.

    csv.Error is NOT a ValueError, so the services' row-level `except (ValueError, KeyError)`
    never catches it — an unterminated quote in a large export escaped all the way out as a
    500 (it raises on the very first fieldnames read, before any row loop).
    """
    try:
        return fn(*args)
    except csv.Error as e:
        raise HTTPException(
            400,
            f"This CSV couldn't be parsed ({e}). An unclosed quote mark is the usual cause — "
            "re-export the file and try again.",
        )


@router.post("/investments-csv")
async def import_investments_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = decode_upload(await file.read())
    return _parse(import_investment_csv, text, session)


@router.post("/transactions-csv")
async def import_transactions_csv_endpoint(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = decode_upload(await file.read())
    return _parse(import_transactions_csv, text, session)


@router.post("/transactions-csv/preview")
async def preview_transactions_csv_endpoint(file: UploadFile = File(...)) -> dict:
    text = decode_upload(await file.read())
    return _parse(preview_transactions_csv, text)


@router.post("/transactions-csv/mapped")
async def import_transactions_csv_mapped_endpoint(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    session: Session = Depends(get_session),
) -> dict:
    text = decode_upload(await file.read())
    try:
        parsed = TransactionCsvMapping.model_validate_json(mapping)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid mapping: {e}")
    return _parse(import_transactions_csv_mapped, text, parsed, session)
