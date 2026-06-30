import json
from app.config import FIXTURES_PATH
from seed import seed
from app.db import get_session


def test_get_data_returns_fixture_shape(client, engine):
    # seed through the same engine the client uses
    from sqlmodel import Session
    with Session(engine) as s:
        seed(s, investments="demo")

    resp = client.get("/api/data")
    assert resp.status_code == 200
    payload = resp.json()
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert set(payload.keys()) == set(base.keys())
    assert len(payload["household"]) >= 1
    assert len(payload["accounts"]) >= 1
