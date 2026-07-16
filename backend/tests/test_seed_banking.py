import json

from sqlmodel import select

from app.config import FIXTURES_PATH
from app.constants import BANK_KINDS
from app.models import Account, AccountOwner, AppMeta, BudgetConfig, BudgetLine, Category, Transaction
from seed import seed


def _base():
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def test_seed_populates_banking_domain(session):
    seed(session)
    base = _base()
    assert len(session.exec(select(Category)).all()) == len(base["categories"])
    assert len(session.exec(select(Transaction)).all()) == len(base["transactions"])
    assert len(session.exec(select(BudgetLine)).all()) == len(base["budget"]["lines"])
    assert session.get(BudgetConfig, 1).mode == base["budget"]["mode"]
    assert session.get(AppMeta, "generatedAt").value == base["meta"]["generatedAt"]


def test_seed_bank_accounts_keep_ids_names_and_opening_balances(session):
    seed(session)
    acc = session.get(Account, "sanjay_chequing")
    assert acc is not None and acc.kind == "chequing"
    assert acc.opening_balance == 14500.0
    # custom_name preserves the fixture display name so screens render identically.
    assert acc.custom_name == "TD Chequing (Sanjay)"
    owners = session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "sanjay_chequing")
    ).all()
    assert [o.person_id for o in owners] == ["sanjay"]
    visa = session.get(Account, "sanjay_td_visa")
    assert visa.is_liability is True


def test_seed_is_idempotent(session):
    seed(session)
    seed(session)
    base = _base()
    assert len(session.exec(select(Transaction)).all()) == len(base["transactions"])
    assert len(session.exec(select(Category)).all()) == len(base["categories"])
    bank = [a for a in session.exec(select(Account)).all() if a.kind in BANK_KINDS]
    assert len(bank) == sum(1 for a in _base()["accounts"] if a["kind"] in BANK_KINDS)


def test_investments_empty_keeps_banking(session):
    seed(session)
    seed(session, investments="empty")
    assert session.get(Account, "sanjay_chequing") is not None
    assert len(session.exec(select(Transaction)).all()) > 0
    inv = [a for a in session.exec(select(Account)).all() if a.kind not in BANK_KINDS]
    assert inv == []
