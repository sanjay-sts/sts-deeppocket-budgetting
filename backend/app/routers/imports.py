from fastapi import APIRouter, Depends, UploadFile, File
from sqlmodel import Session

from ..db import get_session
from ..services.csv_import import import_investment_csv

router = APIRouter(prefix="/api/import", tags=["imports"])


@router.post("/investments-csv")
async def import_investments_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return import_investment_csv(text, session)
