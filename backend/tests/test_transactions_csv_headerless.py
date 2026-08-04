"""Headerless CSV support in the mapping wizard.

Raw bank exports routinely ship with no header row, so csv.DictReader silently consumed the
first transaction as column names. Two real shapes, both headerless and both with no account
column: five columns (date, description, debit, credit, running total) and four (the same
without a description at all).
"""
from sqlmodel import Session, select

from app.models import Account, Category, Transaction
from app.schemas import TransactionCsvMapping
from app.services.transactions_csv import (
    NO_DESCRIPTION, import_transactions_csv_mapped, looks_headerless, preview_transactions_csv,
)

# Five columns: date, description, debit, credit, running total. Newest row first, as exported.
FIVE_COL = """09/19/2025,TIM HORTONS #5021,2.82,,336.36
09/18/2025,BANGKOK KITCHEN,23.09,,333.54
09/17/2025,AMZN Mktp CA*8K0Q62UG3,85.26,,310.45
"""

# Four columns: no description at all. Day-first dates, oldest row first.
FOUR_COL = """30/04/2026,3.95,,5527.21
13/05/2026,90,,5437.21
29/05/2026,3.95,,5433.26
"""


def _setup(session: Session) -> None:
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="visa", institution="TD", account_type="credit_card",
                        kind="credit_card", is_liability=True))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.commit()


def _mapping(**over) -> TransactionCsvMapping:
    base = {
        "dateColumn": "col1", "merchantColumn": "col2",
        "debitColumn": "col3", "creditColumn": "col4",
        "runningTotalColumn": "col5", "accountId": "visa", "headerless": True,
    }
    base.update(over)
    return TransactionCsvMapping(**base)


def test_detects_data_rows_as_headerless():
    assert looks_headerless(["09/19/2025", "TIM HORTONS", "2.82", "", "336.36"]) is True
    assert looks_headerless(["2025-02-04", "GOODLIFE", "63.69", "", "41870.18"]) is True
    assert looks_headerless(["30/04/2026", "3.95", "", "5527.21"]) is True


def test_real_header_rows_are_not_mistaken_for_data():
    # No cell here parses as a date or an amount, unfamiliar though the words are.
    assert looks_headerless(["date", "spent", "incoming", "running total"]) is False
    assert looks_headerless(["account", "date", "merchant", "amount", "payment"]) is False
    assert looks_headerless(["Date", "Transaction_detail", "withdrawal", "deposit"]) is False


def test_preview_keeps_the_first_row_as_data():
    p = preview_transactions_csv(FIVE_COL)
    assert p["headerless"] is True
    assert p["headers"] == ["col1", "col2", "col3", "col4", "col5"]
    # The row that DictReader used to eat is still here.
    assert p["rowCount"] == 3
    assert p["sampleRows"][0]["col2"] == "TIM HORTONS #5021"


def test_preview_still_reads_a_headed_file():
    p = preview_transactions_csv("date,spent,incoming,running total\n30/04/2026,3.95,,5527.21\n")
    assert p["headerless"] is False
    assert p["headers"] == ["date", "spent", "incoming", "running total"]
    assert p["rowCount"] == 1


def test_imports_the_five_column_shape(session):
    _setup(session)
    summary = import_transactions_csv_mapped(FIVE_COL, _mapping(), session)
    assert summary["created"] == 3, summary["errors"]
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["TIM HORTONS #5021"].amount == -2.82
    assert txs["TIM HORTONS #5021"].date == "2025-09-19"
    # The running total is stored now instead of being thrown away.
    assert txs["TIM HORTONS #5021"].running_total == 336.36


def test_imports_the_four_column_shape_without_a_description(session):
    _setup(session)
    mapping = _mapping(
        merchantColumn=None, debitColumn="col2", creditColumn="col3",
        runningTotalColumn="col4", dayFirst=True,
    )
    summary = import_transactions_csv_mapped(FOUR_COL, mapping, session)
    assert summary["created"] == 3, summary["errors"]
    txs = session.exec(select(Transaction)).all()
    assert {t.raw_merchant for t in txs} == {NO_DESCRIPTION}
    assert {t.date for t in txs} == {"2026-04-30", "2026-05-13", "2026-05-29"}


def test_same_day_same_amount_rows_survive_without_a_description(session):
    """Two identical fees on one day are two transactions, not a duplicate."""
    _setup(session)
    twice = "30/04/2026,3.95,,5527.21\n30/04/2026,3.95,,5523.26\n"
    mapping = _mapping(
        merchantColumn=None, debitColumn="col2", creditColumn="col3",
        runningTotalColumn="col4", dayFirst=True,
    )
    summary = import_transactions_csv_mapped(twice, mapping, session)
    # Without the running total in the dedup key these collapse into one row.
    assert summary["created"] == 2 and summary["duplicates"] == 0, summary


def test_headerless_reimport_is_still_idempotent(session):
    _setup(session)
    import_transactions_csv_mapped(FIVE_COL, _mapping(), session)
    again = import_transactions_csv_mapped(FIVE_COL, _mapping(), session)
    assert again["created"] == 0 and again["duplicates"] == 3
    assert len(session.exec(select(Transaction)).all()) == 3


def test_missing_mapped_column_is_reported(session):
    _setup(session)
    summary = import_transactions_csv_mapped(FIVE_COL, _mapping(runningTotalColumn="col9"), session)
    assert summary["created"] == 0
    assert "col9" in summary["errors"][0]["reason"]
