from sqlmodel import SQLModel, Session, create_engine
from .config import DB_URL

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def init_db() -> None:
    import app.models  # noqa: F401  (register tables)
    SQLModel.metadata.create_all(engine)
    # create_all adds missing tables but never missing columns; patch the ones we've
    # added to existing tables so a live DB upgrades in place without a reseed.
    with engine.connect() as conn:
        for table, column, ddl in (
            ("contribution", "recurring_id", "ALTER TABLE contribution ADD COLUMN recurring_id VARCHAR"),
            ("person", "gross_income", "ALTER TABLE person ADD COLUMN gross_income FLOAT"),
            ("account", "is_rental", "ALTER TABLE account ADD COLUMN is_rental BOOLEAN"),
            ("account", "purchase_price", "ALTER TABLE account ADD COLUMN purchase_price FLOAT"),
            ("account", "purchase_date", "ALTER TABLE account ADD COLUMN purchase_date VARCHAR"),
            ("account", "linked_account_id", "ALTER TABLE account ADD COLUMN linked_account_id VARCHAR"),
            # "transaction" is an SQL keyword — quoted everywhere it appears in DDL.
            ("transaction", "property_id", 'ALTER TABLE "transaction" ADD COLUMN property_id VARCHAR'),
        ):
            cols = [r[1] for r in conn.exec_driver_sql(f'PRAGMA table_info("{table}")')]
            if cols and column not in cols:
                conn.exec_driver_sql(ddl)
        conn.commit()


def get_session():
    with Session(engine) as session:
        yield session
