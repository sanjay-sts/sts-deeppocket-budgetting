"""Deriving an account's opening balance from a statement's running-total column.

The arithmetic is checked against real exported rows, because the sign convention is the
easy thing to get backwards: a running total is a cash balance for chequing/savings but the
amount OWED (positive) for a credit card.
"""
from sqlmodel import Session

from app.models import Account, Category, Transaction
from app.schemas import TransactionCsvMapping
from app.services.opening_balance import derive_opening_balance
from app.services.transactions_csv import import_transactions_csv, import_transactions_csv_mapped


def _setup(session: Session) -> None:
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="visa", institution="TD", account_type="credit_card",
                        kind="credit_card", is_liability=True))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.commit()


def _cc_mapping(**over) -> TransactionCsvMapping:
    base = {
        "dateColumn": "col1", "merchantColumn": "col2",
        "debitColumn": "col3", "creditColumn": "col4",
        "runningTotalColumn": "col5", "accountId": "visa", "headerless": True,
    }
    base.update(over)
    return TransactionCsvMapping(**base)


def test_credit_card_opening_is_the_balance_owed_before_the_first_row(session):
    """Real rows: a $2.82 purchase reporting $336.36 owed means $333.54 was owed before it."""
    _setup(session)
    csv_text = """09/17/2025,AMZN MKTP,85.26,,310.45
09/18/2025,BANGKOK KITCHEN,23.09,,333.54
09/19/2025,TIM HORTONS,2.82,,336.36
"""
    import_transactions_csv_mapped(csv_text, _cc_mapping(), session)
    # Owed before the oldest row: 310.45 - 85.26.
    assert session.get(Account, "visa").opening_balance == 225.19


def test_chequing_opening_is_the_cash_balance_before_the_first_row(session):
    """Real rows: a $63.69 withdrawal reporting $41,870.18 means $41,933.87 beforehand."""
    _setup(session)
    csv_text = """2025-02-04,GOODLIFE CLUBS,63.69,,41870.18
2025-02-05,TD INS,169.86,,41700.32
"""
    mapping = _cc_mapping(accountId="chq")
    import_transactions_csv_mapped(csv_text, mapping, session)
    assert session.get(Account, "chq").opening_balance == 41933.87


def test_row_order_in_the_file_does_not_matter(session):
    """Exports come newest-first or oldest-first; derivation sorts by date either way."""
    _setup(session)
    newest_first = """09/19/2025,TIM HORTONS,2.82,,336.36
09/18/2025,BANGKOK KITCHEN,23.09,,333.54
09/17/2025,AMZN MKTP,85.26,,310.45
"""
    import_transactions_csv_mapped(newest_first, _cc_mapping(), session)
    assert session.get(Account, "visa").opening_balance == 225.19


def test_a_later_statement_moves_the_opening_balance_back(session):
    """Deriving from one file's oldest row would be wrong once an earlier file arrives."""
    _setup(session)
    recent = """09/18/2025,BANGKOK KITCHEN,23.09,,333.54
09/19/2025,TIM HORTONS,2.82,,336.36
"""
    import_transactions_csv_mapped(recent, _cc_mapping(), session)
    assert session.get(Account, "visa").opening_balance == 310.45

    earlier = """09/16/2025,PETRO CANADA,106.16,,225.19
09/17/2025,AMZN MKTP,85.26,,310.45
"""
    summary = import_transactions_csv_mapped(earlier, _cc_mapping(), session)
    assert session.get(Account, "visa").opening_balance == 119.03  # 225.19 - 106.16
    # The user is told, because this overrides whatever was there before.
    assert summary["openingBalances"][0]["previousOpeningBalance"] == 310.45
    assert summary["openingBalances"][0]["openingBalance"] == 119.03
    assert summary["reconciliation"] == []


def test_a_gap_in_the_history_is_reported_as_drift(session):
    """Running totals that don't add up mean a missing or duplicated transaction."""
    _setup(session)
    inconsistent = """09/17/2025,AMZN MKTP,85.26,,310.45
09/19/2025,TIM HORTONS,2.82,,999.99
"""
    summary = import_transactions_csv_mapped(inconsistent, _cc_mapping(), session)
    assert len(summary["reconciliation"]) == 1
    drift = summary["reconciliation"][0]
    assert drift["accountId"] == "visa"
    assert drift["reported"] == 999.99
    assert drift["expected"] == 313.27
    assert drift["drift"] == 686.72


def test_a_single_running_total_derives_nothing(session):
    """One row is not enough to reconcile against, so a typed opening balance stands."""
    _setup(session)
    session.get(Account, "visa").opening_balance = 500.0
    session.commit()
    one_row = "09/19/2025,TIM HORTONS,2.82,,336.36\n"
    import_transactions_csv_mapped(one_row, _cc_mapping(), session)
    assert session.get(Account, "visa").opening_balance == 500.0


def test_rows_without_running_totals_derive_nothing(session):
    _setup(session)
    session.get(Account, "chq").opening_balance = 42.0
    session.commit()
    no_totals = """2025-02-04,GOODLIFE CLUBS,63.69,
2025-02-05,TD INS,169.86,
"""
    mapping = _cc_mapping(accountId="chq", runningTotalColumn=None)
    import_transactions_csv_mapped(no_totals, mapping, session)
    assert session.get(Account, "chq").opening_balance == 42.0
    assert derive_opening_balance(session, "chq") is None


def test_the_auto_detect_path_derives_too(session):
    _setup(session)
    bank_csv = """Date,Transaction_detail,withdrawal,deposit,running_total,account
03/31/2026,INTEREST CREDIT,,38.34,22654.91,chq
04/02/2026,SEND E-TFR,120.00,,22534.91,chq
"""
    summary = import_transactions_csv(bank_csv, session)
    assert session.get(Account, "chq").opening_balance == 22616.57  # 22654.91 - 38.34
    assert summary["reconciliation"] == []


def test_the_statement_stays_authoritative_over_a_manual_row(session):
    """A manual row the bank never saw is absorbed into the opening balance.

    The running total is ground truth for what the account holds, so an extra transaction
    ahead of the statement is backed out of the opening rather than double-counted into the
    displayed balance. Same statement without the manual row would derive 225.19.
    """
    _setup(session)
    session.add(Transaction(
        id="manual", account_id="visa", date="2025-09-16", raw_merchant="CASH",
        merchant="Cash", amount=-50.0, category_id="unclassified", source="manual"))
    session.commit()
    csv_text = """09/17/2025,AMZN MKTP,85.26,,310.45
09/18/2025,BANGKOK KITCHEN,23.09,,333.54
"""
    summary = import_transactions_csv_mapped(csv_text, _cc_mapping(), session)
    assert session.get(Account, "visa").opening_balance == 175.19
    # Still reconciles: opening + every amount lands on the newest reported total.
    assert summary["reconciliation"] == []
