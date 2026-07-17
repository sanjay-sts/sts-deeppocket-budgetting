from sqlmodel import Session, select

from app.models import Account, Category, Rule, Transaction
from app.services.transactions_csv import import_transactions_csv

BANK_CSV = """Date,Transaction_detail,withdrawal,deposit,running_total,account
03/31/2026,INTEREST CREDIT,,38.34,22654.91,sav
04/02/2026,SEND E-TFR,120.00,,22534.91,sav
"""

CC_CSV = """Date,merchant,amount,payment,running_total,account
04/30/2026,COSTCO WHOLESALE W1283,73.92,,413.24,visa
04/25/2026,PAYMENT - THANK YOU,,530.51,365.07,visa
"""


def _setup(session: Session) -> None:
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(Category(id="interest", name="Interest", group="income"))
    session.add(Category(id="cc_payment", name="CC payment", group="transfers"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="sav", institution="TD", account_type="savings", kind="savings"))
    session.add(Account(id="visa", institution="TD", account_type="credit_card",
                        kind="credit_card", is_liability=True))
    session.commit()


def test_bank_format_signs_and_dates(session):
    _setup(session)
    summary = import_transactions_csv(BANK_CSV, session)
    assert summary["created"] == 2 and summary["errors"] == []
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["INTEREST CREDIT"].amount == 38.34
    assert txs["INTEREST CREDIT"].date == "2026-03-31"
    assert txs["SEND E-TFR"].amount == -120.00
    assert txs["INTEREST CREDIT"].running_total == 22654.91


def test_cc_format_signs_and_rule_categorization(session):
    _setup(session)
    session.add(Rule(id="r1", keyword="costco", category_id="groceries",
                     created_at="2026-01-01T00:00:00"))
    session.commit()
    summary = import_transactions_csv(CC_CSV, session)
    assert summary["created"] == 2
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["COSTCO WHOLESALE W1283"].amount == -73.92
    assert txs["COSTCO WHOLESALE W1283"].category_id == "groceries"
    assert txs["PAYMENT - THANK YOU"].amount == 530.51
    assert summary["categorized"]["rules"] == 1


def test_history_categorization_and_transfer_flag(session):
    _setup(session)
    session.add(Transaction(id="prev", account_id="visa", date="2026-03-01",
                            raw_merchant="PAYMENT - THANK YOU", merchant="Payment - Thank You",
                            amount=400.0, category_id="cc_payment"))
    session.commit()
    import_transactions_csv(CC_CSV, session)
    new = session.exec(select(Transaction).where(Transaction.date == "2026-04-25")).one()
    assert new.category_id == "cc_payment"
    assert new.is_transfer is True  # transfers-group category sets the flag


def test_reimport_is_idempotent(session):
    _setup(session)
    import_transactions_csv(BANK_CSV, session)
    summary = import_transactions_csv(BANK_CSV, session)
    assert summary == {
        "created": 0, "duplicates": 2, "skipped": 0, "errors": [],
        "categorized": {"history": 0, "rules": 0, "unclassified": 0},
    }
    assert len(session.exec(select(Transaction)).all()) == 2


def test_unknown_account_and_bad_rows(session):
    _setup(session)
    bad = """Date,merchant,amount,payment,running_total,account
04/30/2026,SHOP,10.00,,1.00,nope
BADDATE,SHOP,10.00,,1.00,visa
04/30/2026,SHOP,,,1.00,visa
"""
    summary = import_transactions_csv(bad, session)
    assert summary["created"] == 0 and summary["skipped"] == 3
    reasons = " | ".join(e["reason"] for e in summary["errors"])
    assert "nope" in reasons and "date" in reasons.lower() and "amount" in reasons.lower()


def test_unrecognized_headers(session):
    _setup(session)
    summary = import_transactions_csv("foo,bar\n1,2\n", session)
    assert summary["created"] == 0
    assert summary["errors"][0]["row"] == 0
