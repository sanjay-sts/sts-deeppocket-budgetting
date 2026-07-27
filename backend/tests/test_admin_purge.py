from sqlmodel import Session, select

from app.models import Account, Category, Transaction
from seed import seed
from app.constants import DEFAULT_CATEGORIES


def _seed(engine):
    with Session(engine) as s:
        seed(s)


def test_purge_investments_keeps_banking(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "investments"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert s.get(Account, "chequing_1") is not None
        assert len(s.exec(select(Transaction)).all()) == 864
        kinds = {a.kind for a in s.exec(select(Account)).all()}
        assert kinds <= {"chequing", "savings", "credit_card", "cash"}


def test_purge_all_wipes_banking_too(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "all"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert s.exec(select(Transaction)).all() == []
        assert s.exec(select(Account)).all() == []
        # Categories are wiped with everything else, then re-bootstrapped to the defaults:
        # "clear everything" should leave a blank slate that still works, and a database with
        # no categories cannot classify an import (issue #17).
        names = {c.id for c in s.exec(select(Category)).all()}
        assert names == {c["id"] for c in DEFAULT_CATEGORIES}


def test_purge_demo_restores_everything(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "demo"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert len(s.exec(select(Transaction)).all()) == 864
        assert s.get(Account, "chequing_1") is not None
