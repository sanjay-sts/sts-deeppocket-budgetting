from datetime import date

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..services.fixtures import build_payload
from ..services.recurring import materialize_recurring

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/data")
def get_data(session: Session = Depends(get_session)) -> dict:
    # Catch up recurring deposits (issue #28) so the payload is always current. A
    # deliberate write-on-GET: this local single-user app has no scheduler, and the
    # data read is the one moment guaranteed to run before anything is displayed.
    # Materialization is idempotent, so probes/prefetches can only be no-ops.
    materialize_recurring(session, date.today().isoformat())
    return build_payload(session)
