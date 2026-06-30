from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .db import init_db
from .routers import data, people, accounts, snapshots, imports

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


@app.on_event("startup")
def on_startup() -> None:
    init_db()
