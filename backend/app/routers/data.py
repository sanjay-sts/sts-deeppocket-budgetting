from datetime import date

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..services.fixtures import build_payload
from ..services.recurring import materialize_recurring

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/data")
def get_data(session: Session = Depends(get_session)) -> dict:
    # Catch up recurring deposits (issue #28) so the payload is always current.
    materialize_recurring(session, date.today().isoformat())
    return build_payload(session)
