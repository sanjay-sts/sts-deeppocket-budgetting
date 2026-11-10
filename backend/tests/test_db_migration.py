"""init_db's hand-rolled column patcher.

create_all adds missing tables but never missing columns, so db.py keeps an explicit
PRAGMA+ALTER list. Nothing tested it while it held two columns; at six, a forgotten
entry means a live DB (real imported data — reseeding is not an option) starts 500ing
on the first query that selects the new column.
"""
from sqlmodel import create_engine

import app.db as db


def test_init_db_patches_missing_columns_on_a_live_db(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.connect() as conn:
        # Pre-M5 shapes of the two tables that gained columns.
        conn.exec_driver_sql(
            "CREATE TABLE account (id VARCHAR PRIMARY KEY, institution VARCHAR, "
            "account_type VARCHAR, kind VARCHAR, custom_name VARCHAR, "
            "is_liability BOOLEAN, opening_balance FLOAT)")
        conn.exec_driver_sql(
            'CREATE TABLE "transaction" (id VARCHAR PRIMARY KEY, account_id VARCHAR, '
            "date VARCHAR, raw_merchant VARCHAR, merchant VARCHAR, amount FLOAT, "
            "category_id VARCHAR)")
        conn.exec_driver_sql("INSERT INTO account (id, institution, account_type, kind) "
                             "VALUES ('a1', 'TD', 'chequing', 'chequing')")
        conn.commit()

    monkeypatch.setattr(db, "engine", eng)
    db.init_db()

    with eng.connect() as conn:
        acc_cols = {r[1] for r in conn.exec_driver_sql('PRAGMA table_info("account")')}
        tx_cols = {r[1] for r in conn.exec_driver_sql('PRAGMA table_info("transaction")')}
        # Existing rows survive the patch with the new columns NULL.
        row = conn.exec_driver_sql(
            "SELECT is_rental, purchase_price, purchase_date, linked_account_id "
            "FROM account WHERE id='a1'").fetchone()
    assert {"is_rental", "purchase_price", "purchase_date", "linked_account_id"} <= acc_cols
    assert "property_id" in tx_cols
    assert tuple(row) == (None, None, None, None)
