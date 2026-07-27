from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlmodel import Session

from .config import CORS_ORIGINS
from .db import engine, init_db
from .services.bootstrap import bootstrap_default_categories
from .routers import data, people, accounts, snapshots, imports, contributions, room, recurring, admin, transactions, rules, categories, budget

app = FastAPI(title="DeepPocket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(people.router)
app.include_router(accounts.router)
app.include_router(snapshots.router)
app.include_router(imports.router)
app.include_router(contributions.router)
app.include_router(room.router)
app.include_router(recurring.router)
app.include_router(admin.router)
app.include_router(transactions.router)
app.include_router(rules.router)
app.include_router(categories.router)
app.include_router(budget.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    # A database with no categories can't classify anything, so give a brand-new one the
    # default set (issue #17). No-ops the moment any category exists.
    with Session(engine) as session:
        bootstrap_default_categories(session)
