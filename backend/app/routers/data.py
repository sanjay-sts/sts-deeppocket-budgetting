from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..services.fixtures import build_payload

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/data")
def get_data(session: Session = Depends(get_session)) -> dict:
    return build_payload(session)
