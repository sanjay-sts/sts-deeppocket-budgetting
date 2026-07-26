from sqlmodel import SQLModel, Session, create_engine
from .config import DB_URL

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def init_db() -> None:
    import app.models  # noqa: F401  (register tables)
    SQLModel.metadata.create_all(engine)
    # create_all adds missing tables but never missing columns; patch the ones we've
    # added to existing tables so a live DB upgrades in place without a reseed.
    with engine.connect() as conn:
        cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(contribution)")]
        if cols and "recurring_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE contribution ADD COLUMN recurring_id VARCHAR")
            conn.commit()


def get_session():
    with Session(engine) as session:
        yield session
