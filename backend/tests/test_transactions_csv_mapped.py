import json

from sqlmodel import Session, select

from app.models import Account, Category, Transaction
from app.schemas import TransactionCsvMapping
from app.services.transactions_csv import (
    import_transactions_csv_mapped,
    preview_transactions_csv,
)

# Arbitrary bank export the auto-detector would NOT recognise.
ARBITRARY_CSV = """Posted,Description,Debit,Credit,Acct
2026-05-01,LOBLAWS,45.20,,chq
2026-05-02,PAYROLL,,2000.00,chq
"""

SIGNED_CSV = """when,who,value,acct
05/03/2026,TIM HORTONS,-4.50,chq
05/04/2026,REFUND,10.00,chq
"""


def _setup(session: Session) -> None:
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.commit()


def test_preview_returns_headers_and_samples():
    p = preview_transactions_csv(ARBITRARY_CSV)
    assert p["headers"] == ["Posted", "Description", "Debit", "Credit", "Acct"]
    assert p["rowCount"] == 2
    assert p["sampleRows"][0]["Description"] == "LOBLAWS"


def test_mapped_split_debit_credit(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="Posted", merchantColumn="Description",
        debitColumn="Debit", creditColumn="Credit", accountColumn="Acct",
    )
    s = import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    assert s["created"] == 2 and s["errors"] == []
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["LOBLAWS"].amount == -45.20
    assert txs["PAYROLL"].amount == 2000.00
    assert txs["LOBLAWS"].date == "2026-05-01"


def test_mapped_single_signed_with_fixed_account(session):
    _setup(session)
    m = TransactionCsvMapping(dateColumn="when", merchantColumn="who", amountColumn="value", accountId="chq")
    s = import_transactions_csv_mapped(SIGNED_CSV, m, session)
    assert s["created"] == 2
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["TIM HORTONS"].amount == -4.50
    assert txs["TIM HORTONS"].date == "2026-05-03"  # 05/03/2026 = MM/DD/YYYY


def test_mapped_amount_invert(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="when", merchantColumn="who", amountColumn="value", amountInvert=True, accountId="chq",
    )
    import_transactions_csv_mapped(SIGNED_CSV, session=session, mapping=m)
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["TIM HORTONS"].amount == 4.50


def test_mapped_day_first_date(session):
    _setup(session)
    csv_text = "when,who,value,acct\n03/05/2026,SHOP,-9.00,chq\n"  # 3 May under dayFirst
    m = TransactionCsvMapping(dateColumn="when", merchantColumn="who", amountColumn="value", accountId="chq", dayFirst=True)
    import_transactions_csv_mapped(csv_text, m, session)
    txs = {t.raw_merchant: t for t in session.exec(select(Transaction)).all()}
    assert txs["SHOP"].date == "2026-05-03"


def test_mapped_missing_column_row0_error(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="Nope", merchantColumn="Description",
        debitColumn="Debit", creditColumn="Credit", accountColumn="Acct",
    )
    s = import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    assert s["created"] == 0
    assert s["errors"][0]["row"] == 0 and "not found" in s["errors"][0]["reason"]


def test_mapped_contradictory_amount_modes(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="Posted", merchantColumn="Description",
        amountColumn="Debit", debitColumn="Debit", accountColumn="Acct",
    )
    s = import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    assert s["created"] == 0 and s["errors"][0]["row"] == 0


def test_mapped_unknown_account_skips_rows(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="Posted", merchantColumn="Description",
        debitColumn="Debit", creditColumn="Credit", accountId="ghost",
    )
    s = import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    assert s["created"] == 0 and s["skipped"] == 2


def test_mapped_dedup_idempotent(session):
    _setup(session)
    m = TransactionCsvMapping(
        dateColumn="Posted", merchantColumn="Description",
        debitColumn="Debit", creditColumn="Credit", accountColumn="Acct",
    )
    import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    s2 = import_transactions_csv_mapped(ARBITRARY_CSV, m, session)
    assert s2["created"] == 0 and s2["duplicates"] == 2


def test_endpoints_preview_and_mapped(client, session):
    _setup(session)
    preview = client.post(
        "/api/import/transactions-csv/preview",
        files={"file": ("x.csv", ARBITRARY_CSV, "text/csv")},
    )
    assert preview.status_code == 200 and "Posted" in preview.json()["headers"]

    mapping = {
        "dateColumn": "Posted", "merchantColumn": "Description",
        "debitColumn": "Debit", "creditColumn": "Credit", "accountColumn": "Acct",
    }
    r = client.post(
        "/api/import/transactions-csv/mapped",
        files={"file": ("x.csv", ARBITRARY_CSV, "text/csv")},
        data={"mapping": json.dumps(mapping)},
    )
    assert r.status_code == 200 and r.json()["created"] == 2
