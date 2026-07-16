# M2 — Backend + Editable Investment Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a FastAPI + SQLite backend and make the investment domain (people, accounts, balance snapshots, registered-account contributions) fully editable and persistent, while every existing M1 screen keeps rendering unchanged.

**Architecture:** The backend serves the **same fixtures-shaped JSON** from `GET /api/data` that M1 imported statically, so the swap is confined to the one data seam (`frontend/src/data/api.ts`) plus the Zustand store. Read-only M1 data (categories, rules, transactions, budget, bank/credit accounts, craLimits, meta) is loaded from the bundled `mock/out/fixtures.json` at request time; the **editable** domain (persons, investment accounts, snapshots, contributions) lives in SQLite tables and is overlaid on top. CESG grants are **derived** from RESP contributions on every read, never hand-entered. Mutations are ordinary REST resources; after each write the store refetches `GET /api/data` so every screen stays consistent (the single-source-of-truth property M1 had in memory).

**Tech Stack:** Backend — Python 3.11+, FastAPI, SQLModel, SQLite, uvicorn, python-multipart, pytest, httpx (TestClient). Frontend — existing Vite + React 18 + TypeScript (strict) + Zustand + Recharts + Tailwind; Vitest + @testing-library added for tests.

**Spec:** `docs/superpowers/specs/2026-06-28-m2-backend-editable-investments-design.md`

---

## Conventions used in this plan

- **Run backend commands from `backend/`** with the venv activated, unless stated otherwise.
- **Run frontend commands from `frontend/`.**
- Windows PowerShell venv activate: `.\.venv\Scripts\Activate.ps1`. (Bash: `source .venv/Scripts/activate`.)
- IDs are **strings** everywhere (matching the M1 `PersonId = string` / `AccountId = string` types). Seeded rows keep their original fixture ids (`p1`, `acc_rrsp_sanjay`, …); new rows get `f"{prefix}_{uuid4().hex[:8]}"`.
- `AccountKind` (the only legal `kind` values served to the frontend):
  `chequing | savings | credit_card | tfsa | rrsp | resp | fhsa | dcpp | non_registered | crypto`.
- **Investment kinds** (served from the DB): `tfsa, rrsp, resp, fhsa, dcpp, non_registered, crypto`.
  **Bank kinds** (served read-only from the fixtures file): `chequing, savings, credit_card`.
- `ContributionKind`: `tfsa | rrsp | resp | fhsa`.
- Commit after every task. Use conventional-commit prefixes (`feat:`, `test:`, `chore:`).

---

## File structure

```
backend/                                NEW — Python package, runs via uvicorn
  .gitignore                            .venv/, *.db, __pycache__/
  requirements.txt                      fastapi, uvicorn[standard], sqlmodel, python-multipart, pytest, httpx
  app/
    __init__.py
    config.py                           paths (FIXTURES_PATH, DB_URL), CORS origins
    constants.py                        INVESTMENT_KINDS, BANK_KINDS, KIND_MAP, normalize_kind(), new_id()
    db.py                               engine, init_db(), get_session() dependency
    models.py                           SQLModel tables: Person, Account, InvestmentSnapshot, Contribution
    schemas.py                          Pydantic request/response models (camelCase aliases)
    services/
      __init__.py
      fixtures.py                       build_payload(session) -> fixtures-shaped dict
      cesg.py                           derive_cesg_grants(contributions, limits) -> list[dict]
      csv_import.py                     import_investment_csv(text, session) -> summary dict
    routers/
      __init__.py
      data.py                           GET /api/data
      people.py                         CRUD /api/people
      accounts.py                       CRUD /api/accounts
      snapshots.py                      CRUD + upsert /api/snapshots
      contributions.py                  CRUD /api/contributions
      imports.py                        POST /api/import/investments-csv
    main.py                             FastAPI app, CORS, include_routers, init_db on startup
  seed.py                               idempotent seeder; --investments=empty flag
  tests/
    conftest.py                         in-memory DB + TestClient fixtures
    test_cesg.py
    test_fixtures_payload.py
    test_seed.py
    test_people_accounts.py
    test_snapshots.py
    test_contributions.py
    test_csv_import.py
    test_data_endpoint.py

frontend/                               MODIFIED
  vite.config.ts                        add server.proxy '/api' -> http://localhost:8000
  vitest.config.ts                      NEW — test config (jsdom)
  package.json                          add vitest + @testing-library deps, "test" script
  src/data/api.ts                       seam: static import -> fetch + write methods
  src/store/useAppStore.ts              async write actions; refetch-after-mutate
  src/lib/canadian.ts                   add `respKidIds` helper (unchanged signatures otherwise)
  src/pages/Settings.tsx                Household + Investment-accounts management
  src/pages/Investments.tsx             editable snapshot grid + add/update form + contributions
  src/pages/Import.tsx                  real investments CSV import (was a stub)
  src/data/__tests__/api.test.ts        NEW
  src/store/__tests__/store.test.ts     NEW
  src/lib/__tests__/kpi.test.ts         NEW
  src/lib/__tests__/canadian.test.ts    NEW
```

---

## Phase 0 — Backend scaffold

### Task 0.1: Create the backend package skeleton

**Files:**
- Create: `backend/.gitignore`
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py` (empty)
- Create: `backend/app/services/__init__.py` (empty)
- Create: `backend/app/routers/__init__.py` (empty)
- Create: `backend/tests/__init__.py` (empty)

- [ ] **Step 1: Write `backend/.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
*.db
.pytest_cache/
```

- [ ] **Step 2: Write `backend/requirements.txt`**

```text
fastapi==0.115.6
uvicorn[standard]==0.34.0
sqlmodel==0.0.22
python-multipart==0.0.20
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 3: Create the four empty `__init__.py` files**

Create `backend/app/__init__.py`, `backend/app/services/__init__.py`, `backend/app/routers/__init__.py`, `backend/tests/__init__.py`, each empty.

- [ ] **Step 4: Create the venv and install**

Run (from `backend/`):
```
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
Expected: installs without error; `python -c "import fastapi, sqlmodel"` prints nothing and exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/.gitignore backend/requirements.txt backend/app backend/tests
git commit -m "chore: scaffold backend package and dependencies"
```

---

### Task 0.2: Config and constants

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/constants.py`

- [ ] **Step 1: Write `backend/app/config.py`**

```python
from pathlib import Path

# repo-root/backend/app/config.py -> parents[2] == repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_PATH = REPO_ROOT / "mock" / "out" / "fixtures.json"

# Default on-disk SQLite db lives next to seed.py (backend/deeppocket.db).
DB_PATH = REPO_ROOT / "backend" / "deeppocket.db"
DB_URL = f"sqlite:///{DB_PATH}"

# Vite dev origins allowed to call the API.
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
```

- [ ] **Step 2: Write `backend/app/constants.py`**

```python
import re
import uuid

# kinds served to the frontend (must stay within the AccountKind union)
BANK_KINDS = {"chequing", "savings", "credit_card"}
INVESTMENT_KINDS = {"tfsa", "rrsp", "resp", "fhsa", "dcpp", "non_registered", "crypto"}

# free-text account_type -> a legal AccountKind. Unknown types fall back to non_registered.
KIND_MAP = {
    "tfsa": "tfsa",
    "rrsp": "rrsp",
    "resp": "resp",
    "fhsa": "fhsa",
    "crypto": "crypto",
    "dcpp": "dcpp",
    "dccp2": "dcpp",
    "dcpp2": "dcpp",
    "rpp": "dcpp",
    "non_registered": "non_registered",
    "nonregistered": "non_registered",
    "margin": "non_registered",
    "cash": "non_registered",
}

CONTRIBUTION_KINDS = {"tfsa", "rrsp", "resp", "fhsa"}


def normalize_kind(account_type: str) -> str:
    return KIND_MAP.get(account_type.strip().lower(), "non_registered")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def normalize_date(s: str) -> str:
    """Accept 'YYYYMMDD' or 'YYYY-MM-DD'; return ISO 'YYYY-MM-DD'. Raise on anything else."""
    s = s.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    raise ValueError(f"Unrecognized date format: {s!r} (expected YYYYMMDD or YYYY-MM-DD)")
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/config.py backend/app/constants.py
git commit -m "feat: backend config paths and kind-normalization constants"
```

---

## Phase 1 — Backend foundation: models, DB, services, GET /api/data, seam swap

> **Exit criterion for the phase:** all 10 existing screens render from the backend with zero screen-level changes. (Issue #1.)

### Task 1.1: Database tables (models)

**Files:**
- Create: `backend/app/models.py`

- [ ] **Step 1: Write `backend/app/models.py`**

```python
from typing import Optional
from sqlmodel import SQLModel, Field, UniqueConstraint


class Person(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    role: str  # 'adult' | 'child'
    birth_year: Optional[int] = None


class Account(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("person_id", "institution", "account_type", name="uq_account_natural_key"),
    )
    id: str = Field(primary_key=True)
    person_id: str = Field(foreign_key="person.id", index=True)
    institution: str
    account_type: str          # free text, e.g. "dccp2"
    kind: str                  # a legal AccountKind value (see constants)
    name: str
    is_liability: bool = False
    beneficiary_person_id: Optional[str] = Field(default=None, foreign_key="person.id")


class InvestmentSnapshot(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("account_id", "date", name="uq_snapshot_account_date"),
    )
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    date: str                  # ISO 'YYYY-MM-DD'
    amount: float


class Contribution(SQLModel, table=True):
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    person_id: str = Field(foreign_key="person.id")
    date: str                  # ISO 'YYYY-MM-DD'
    amount: float
    kind: str                  # 'tfsa' | 'rrsp' | 'resp' | 'fhsa'
    beneficiary_person_id: Optional[str] = Field(default=None, foreign_key="person.id")
```

- [ ] **Step 2: Write `backend/app/db.py`**

```python
from sqlmodel import SQLModel, Session, create_engine
from .config import DB_URL

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def init_db() -> None:
    import app.models  # noqa: F401  (register tables)
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
```

- [ ] **Step 3: Sanity-check tables build**

Run (from `backend/`, venv active):
```
python -c "from app.db import engine; import app.models; from sqlmodel import SQLModel; SQLModel.metadata.create_all(engine); print('ok')"
```
Expected: prints `ok`, creates `backend/deeppocket.db`. Then delete it: `Remove-Item backend/deeppocket.db`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/db.py
git commit -m "feat: SQLModel tables and SQLite engine"
```

---

### Task 1.2: pytest harness (conftest)

**Files:**
- Create: `backend/tests/conftest.py`
- Create: `backend/pytest.ini`

- [ ] **Step 1: Write `backend/pytest.ini`**

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 2: Write `backend/tests/conftest.py`**

```python
import pytest
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool
from fastapi.testclient import TestClient

import app.models  # noqa: F401  register tables


@pytest.fixture(name="engine")
def engine_fixture():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine


@pytest.fixture(name="session")
def session_fixture(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(engine):
    from app.main import app
    from app.db import get_session

    def get_session_override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
```

- [ ] **Step 3: Verify the harness collects (no tests yet is fine)**

Run: `pytest -q`
Expected: `no tests ran` (exit code 5) — confirms imports resolve. (`app.main` doesn't exist yet; if collection errors on that import, that's expected until Task 1.6 — the `client` fixture is unused so far.)

> Note: the `client` fixture imports `app.main` lazily inside the fixture body, so collection does **not** fail before Task 1.6 as long as no test requests `client` yet.

- [ ] **Step 4: Commit**

```bash
git add backend/pytest.ini backend/tests/conftest.py
git commit -m "test: backend pytest harness with in-memory db + TestClient"
```

---

### Task 1.3: CESG derivation service (TDD)

**Files:**
- Create: `backend/tests/test_cesg.py`
- Create: `backend/app/services/cesg.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_cesg.py`:
```python
from app.models import Contribution
from app.services.cesg import derive_cesg_grants

LIMITS = {"CESG_RATE": 0.20, "CESG_ANNUAL_PER_CHILD": 500, "CESG_LIFETIME_PER_CHILD": 7200}


def _resp(id, date, amount, beneficiary, account="acc1", person="p1"):
    return Contribution(
        id=id, account_id=account, person_id=person, date=date,
        amount=amount, kind="resp", beneficiary_person_id=beneficiary,
    )


def test_basic_20_percent_grant():
    grants = derive_cesg_grants([_resp("c1", "2025-03-01", 1000, "k1")], LIMITS)
    assert len(grants) == 1
    g = grants[0]
    assert g["amount"] == 200.0
    assert g["beneficiaryId"] == "k1"
    assert g["contributionEventId"] == "c1"
    assert g["accountId"] == "acc1"
    assert g["date"] == "2025-03-01"


def test_annual_cap_500_per_child():
    # 2 * 2000 contributions in one year -> raw grant 400 + 400, capped at 500/yr
    grants = derive_cesg_grants(
        [_resp("c1", "2025-02-01", 2000, "k1"), _resp("c2", "2025-09-01", 2000, "k1")],
        LIMITS,
    )
    assert sum(g["amount"] for g in grants) == 500.0


def test_annual_cap_resets_next_year():
    grants = derive_cesg_grants(
        [_resp("c1", "2025-06-01", 3000, "k1"), _resp("c2", "2026-06-01", 3000, "k1")],
        LIMITS,
    )
    by_year = {}
    for g in grants:
        by_year[g["date"][:4]] = by_year.get(g["date"][:4], 0) + g["amount"]
    assert by_year["2025"] == 500.0
    assert by_year["2026"] == 500.0


def test_lifetime_cap_7200():
    # 20 years of max $2500 (grant $500) = $10000 raw, capped at $7200 lifetime
    events = [_resp(f"c{y}", f"{2000 + y}-06-01", 2500, "k1") for y in range(20)]
    grants = derive_cesg_grants(events, LIMITS)
    assert round(sum(g["amount"] for g in grants), 2) == 7200.0


def test_non_resp_and_unbeneficiaried_ignored():
    rrsp = Contribution(id="c1", account_id="a", person_id="p1", date="2025-01-01",
                        amount=1000, kind="rrsp", beneficiary_person_id=None)
    resp_no_kid = _resp("c2", "2025-01-01", 1000, None)
    assert derive_cesg_grants([rrsp, resp_no_kid], LIMITS) == []


def test_per_child_independent_caps():
    grants = derive_cesg_grants(
        [_resp("c1", "2025-01-01", 3000, "k1"), _resp("c2", "2025-01-01", 3000, "k2")],
        LIMITS,
    )
    by_kid = {}
    for g in grants:
        by_kid[g["beneficiaryId"]] = by_kid.get(g["beneficiaryId"], 0) + g["amount"]
    assert by_kid == {"k1": 500.0, "k2": 500.0}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_cesg.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.cesg'`.

- [ ] **Step 3: Write the minimal implementation**

`backend/app/services/cesg.py`:
```python
"""Derive CESG grants from RESP contributions.

CESG = 20% of each RESP contribution, capped at CESG_ANNUAL_PER_CHILD per child per
calendar year and CESG_LIFETIME_PER_CHILD per child for life. Grants are derived on
every read so they can never drift from the contributions they depend on.
"""
from typing import Iterable


def derive_cesg_grants(contributions: Iterable, limits: dict) -> list[dict]:
    rate = limits["CESG_RATE"]
    annual_cap = limits["CESG_ANNUAL_PER_CHILD"]
    lifetime_cap = limits["CESG_LIFETIME_PER_CHILD"]

    resp = [
        c for c in contributions
        if c.kind == "resp" and c.beneficiary_person_id
    ]
    resp.sort(key=lambda c: (c.date, c.id))

    per_year: dict[tuple, float] = {}
    lifetime: dict[str, float] = {}
    grants: list[dict] = []

    for c in resp:
        year = c.date[:4]
        kid = c.beneficiary_person_id
        raw = c.amount * rate
        annual_room = max(0.0, annual_cap - per_year.get((kid, year), 0.0))
        lifetime_room = max(0.0, lifetime_cap - lifetime.get(kid, 0.0))
        grant = round(min(raw, annual_room, lifetime_room), 2)
        if grant <= 0:
            continue
        per_year[(kid, year)] = per_year.get((kid, year), 0.0) + grant
        lifetime[kid] = lifetime.get(kid, 0.0) + grant
        grants.append({
            "id": f"cesg_{c.id}",
            "date": c.date,
            "beneficiaryId": kid,
            "contributionEventId": c.id,
            "amount": grant,
            "accountId": c.account_id,
        })
    return grants
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_cesg.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/cesg.py backend/tests/test_cesg.py
git commit -m "feat: CESG grant derivation with annual + lifetime caps"
```

---

### Task 1.4: Fixtures payload assembler (TDD)

**Files:**
- Create: `backend/tests/test_fixtures_payload.py`
- Create: `backend/app/services/fixtures.py`

The assembler reads the read-only M1 data from `FIXTURES_PATH` and overlays the editable
domain from the DB. The served `investments` array is **id-less** (matches `InvestmentSnapshot`
in `types/index.ts`); the editable grid uses `GET /api/snapshots` (Task 3.1) for id-bearing rows.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fixtures_payload.py`:
```python
import json
from app.models import Person, Account, InvestmentSnapshot, Contribution
from app.services.fixtures import build_payload
from app.config import FIXTURES_PATH


def test_payload_has_all_fixture_keys(session):
    payload = build_payload(session)
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert set(payload.keys()) == set(base.keys())


def test_household_comes_from_db(session):
    session.add(Person(id="p9", name="Tester", role="adult", birth_year=1990))
    session.commit()
    payload = build_payload(session)
    assert {"id": "p9", "name": "Tester", "role": "adult", "birthYear": 1990} in payload["household"]


def test_investment_accounts_from_db_banks_from_file(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", person_id="p1", institution="Questrade",
                        account_type="tfsa", kind="tfsa", name="Questrade TFSA"))
    session.commit()
    payload = build_payload(session)
    kinds = {a["kind"] for a in payload["accounts"]}
    # the db tfsa account is present...
    assert any(a["id"] == "x1" and a["ownerIds"] == ["p1"] for a in payload["accounts"])
    # ...and bank kinds still come through from the read-only file
    assert "chequing" in kinds or "savings" in kinds or "credit_card" in kinds


def test_snapshots_are_id_less(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="x1", person_id="p1", institution="Q", account_type="tfsa",
                        kind="tfsa", name="Q TFSA"))
    session.add(InvestmentSnapshot(id="s1", account_id="x1", date="2025-01-31", amount=100.0))
    session.commit()
    payload = build_payload(session)
    assert {"date": "2025-01-31", "accountId": "x1", "amount": 100.0} in payload["investments"]
    assert all("id" not in snap for snap in payload["investments"])


def test_cesg_grants_derived_from_contributions(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Person(id="k1", name="Kiran", role="child"))
    session.add(Account(id="x1", person_id="p1", institution="WS", account_type="resp",
                        kind="resp", name="WS RESP", beneficiary_person_id="k1"))
    session.add(Contribution(id="c1", account_id="x1", person_id="p1", date="2025-02-01",
                             amount=1000.0, kind="resp", beneficiary_person_id="k1"))
    session.commit()
    payload = build_payload(session)
    assert any(g["beneficiaryId"] == "k1" and g["amount"] == 200.0 for g in payload["cesgGrants"])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_fixtures_payload.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.fixtures'`.

- [ ] **Step 3: Write the implementation**

`backend/app/services/fixtures.py`:
```python
import json
from sqlmodel import Session, select

from ..config import FIXTURES_PATH
from ..constants import BANK_KINDS
from ..models import Person, Account, InvestmentSnapshot, Contribution
from .cesg import derive_cesg_grants


def _load_base() -> dict:
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def _person_out(p: Person) -> dict:
    out = {"id": p.id, "name": p.name, "role": p.role}
    if p.birth_year is not None:
        out["birthYear"] = p.birth_year
    return out


def _account_out(a: Account) -> dict:
    out = {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "institution": a.institution,
        "ownerIds": [a.person_id],
    }
    if a.beneficiary_person_id:
        out["beneficiaryId"] = a.beneficiary_person_id
    if a.is_liability:
        out["isLiability"] = True
    return out


def _contribution_out(c: Contribution) -> dict:
    out = {
        "id": c.id,
        "date": c.date,
        "accountId": c.account_id,
        "personId": c.person_id,
        "amount": c.amount,
        "kind": c.kind,
    }
    if c.beneficiary_person_id:
        out["beneficiaryId"] = c.beneficiary_person_id
    return out


def build_payload(session: Session) -> dict:
    base = _load_base()

    people = session.exec(select(Person)).all()
    accounts = session.exec(select(Account)).all()
    snapshots = session.exec(select(InvestmentSnapshot)).all()
    contributions = session.exec(select(Contribution)).all()

    bank_accounts = [a for a in base["accounts"] if a["kind"] in BANK_KINDS]
    db_accounts = [_account_out(a) for a in accounts]

    grants = derive_cesg_grants(contributions, base["craLimits"])

    return {
        "household": [_person_out(p) for p in people],
        "accounts": bank_accounts + db_accounts,
        "categories": base["categories"],
        "rules": base["rules"],
        "transactions": base["transactions"],
        "investments": [
            {"date": s.date, "accountId": s.account_id, "amount": s.amount}
            for s in snapshots
        ],
        "contributionEvents": [_contribution_out(c) for c in contributions],
        "cesgGrants": grants,
        "budget": base["budget"],
        "craLimits": base["craLimits"],
        "meta": base["meta"],
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_fixtures_payload.py -v`
Expected: 5 passed. (Requires `mock/out/fixtures.json` to exist — it does. If missing, run `python mock/generate.py` from repo root first.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/fixtures.py backend/tests/test_fixtures_payload.py
git commit -m "feat: assemble fixtures-shaped payload from db + read-only file"
```

---

### Task 1.5: Seeder (TDD)

**Files:**
- Create: `backend/tests/test_seed.py`
- Create: `backend/seed.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_seed.py`:
```python
from sqlmodel import select
from app.models import Person, Account, InvestmentSnapshot, Contribution
from seed import seed


def test_seed_populates_editable_domain(session):
    seed(session, investments="demo")
    assert len(session.exec(select(Person)).all()) >= 1
    assert len(session.exec(select(Account)).all()) >= 1
    assert len(session.exec(select(InvestmentSnapshot)).all()) >= 1


def test_seed_is_idempotent(session):
    seed(session, investments="demo")
    p1 = len(session.exec(select(Person)).all())
    a1 = len(session.exec(select(Account)).all())
    s1 = len(session.exec(select(InvestmentSnapshot)).all())
    seed(session, investments="demo")
    assert len(session.exec(select(Person)).all()) == p1
    assert len(session.exec(select(Account)).all()) == a1
    assert len(session.exec(select(InvestmentSnapshot)).all()) == s1


def test_seed_investments_empty_keeps_people_drops_investments(session):
    seed(session, investments="empty")
    assert len(session.exec(select(Person)).all()) >= 1
    assert session.exec(select(Account)).all() == []
    assert session.exec(select(InvestmentSnapshot)).all() == []
    assert session.exec(select(Contribution)).all() == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_seed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'seed'`.

- [ ] **Step 3: Write the seeder**

`backend/seed.py`:
```python
"""Idempotent seeder: load M1 mock fixtures into the editable tables.

Usage (from backend/, venv active):
    python seed.py                      # full demo data
    python seed.py --investments=empty  # people only; investment domain starts clean
"""
import argparse
import json

from sqlmodel import Session, select

from app.config import FIXTURES_PATH
from app.constants import INVESTMENT_KINDS, new_id
from app.db import engine, init_db
from app.models import Person, Account, InvestmentSnapshot, Contribution


def _upsert(session: Session, model, pk: str, values: dict):
    existing = session.get(model, pk)
    if existing:
        for k, v in values.items():
            setattr(existing, k, v)
        session.add(existing)
        return existing
    obj = model(id=pk, **values)
    session.add(obj)
    return obj


def seed(session: Session, investments: str = "demo") -> None:
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    # People are always seeded (the household is real even in 'empty' mode).
    for p in base["household"]:
        _upsert(session, Person, p["id"], {
            "name": p["name"], "role": p["role"], "birth_year": p.get("birthYear"),
        })
    session.commit()

    if investments == "empty":
        # Drop any previously-seeded investment domain so it starts clean.
        for model in (Contribution, InvestmentSnapshot, Account):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()
        return

    for a in base["accounts"]:
        if a["kind"] not in INVESTMENT_KINDS:
            continue
        owner = a["ownerIds"][0]
        _upsert(session, Account, a["id"], {
            "person_id": owner,
            "institution": a["institution"],
            "account_type": a["kind"],   # seed account_type from the known kind
            "kind": a["kind"],
            "name": a["name"],
            "is_liability": a.get("isLiability", False),
            "beneficiary_person_id": a.get("beneficiaryId"),
        })
    session.commit()

    # Snapshots are keyed by (account_id, date); re-seeding overwrites, never duplicates.
    existing_snap = {
        (s.account_id, s.date): s
        for s in session.exec(select(InvestmentSnapshot)).all()
    }
    for s in base["investments"]:
        key = (s["accountId"], s["date"])
        if key in existing_snap:
            existing_snap[key].amount = s["amount"]
            session.add(existing_snap[key])
        else:
            session.add(InvestmentSnapshot(
                id=new_id("snap"), account_id=s["accountId"],
                date=s["date"], amount=s["amount"],
            ))
    session.commit()

    existing_contrib_ids = {c.id for c in session.exec(select(Contribution)).all()}
    for c in base["contributionEvents"]:
        if c["id"] in existing_contrib_ids:
            continue
        session.add(Contribution(
            id=c["id"], account_id=c["accountId"], person_id=c["personId"],
            date=c["date"], amount=c["amount"], kind=c["kind"],
            beneficiary_person_id=c.get("beneficiaryId"),
        ))
    session.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--investments", choices=["demo", "empty"], default="demo")
    args = parser.parse_args()
    init_db()
    with Session(engine) as session:
        seed(session, investments=args.investments)
    print(f"Seeded (investments={args.investments}).")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_seed.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/seed.py backend/tests/test_seed.py
git commit -m "feat: idempotent seeder with --investments=empty mode"
```

---

### Task 1.6: GET /api/data endpoint + app wiring (TDD)

**Files:**
- Create: `backend/app/routers/data.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/test_data_endpoint.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_data_endpoint.py`:
```python
import json
from app.config import FIXTURES_PATH
from seed import seed
from app.db import get_session


def test_get_data_returns_fixture_shape(client, engine):
    # seed through the same engine the client uses
    from sqlmodel import Session
    with Session(engine) as s:
        seed(s, investments="demo")

    resp = client.get("/api/data")
    assert resp.status_code == 200
    payload = resp.json()
    base = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert set(payload.keys()) == set(base.keys())
    assert len(payload["household"]) >= 1
    assert len(payload["accounts"]) >= 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_data_endpoint.py -v`
Expected: FAIL — app/router import error (`app.main` / `app.routers.data` missing).

- [ ] **Step 3: Write the data router**

`backend/app/routers/data.py`:
```python
from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..services.fixtures import build_payload

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/data")
def get_data(session: Session = Depends(get_session)) -> dict:
    return build_payload(session)
```

- [ ] **Step 4: Write the app**

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .db import init_db
from .routers import data

app = FastAPI(title="DeepPocket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
```

- [ ] **Step 5: Run to verify it passes**

Run: `pytest tests/test_data_endpoint.py -v`
Expected: 1 passed.

- [ ] **Step 6: Manual smoke — run the server**

Run (from `backend/`): `python seed.py` then `uvicorn app.main:app --port 8000`.
In another shell: open `http://localhost:8000/api/data` — expect the full JSON. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/data.py backend/app/main.py backend/tests/test_data_endpoint.py
git commit -m "feat: GET /api/data endpoint serving fixtures-shaped payload"
```

---

### Task 1.7: Swap the frontend seam to fetch + Vite proxy

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/data/api.ts`

- [ ] **Step 1: Add the dev proxy to `frontend/vite.config.ts`**

Replace the `server` block:
```ts
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
```

- [ ] **Step 2: Rewrite `frontend/src/data/api.ts` to fetch**

```ts
// Single seam between the UI and the data source.
// M2: reads from the FastAPI backend over HTTP. This is the ONLY module that
// knows where data comes from — screens never fetch directly.

import type { Fixtures } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function loadFixtures(): Promise<Fixtures> {
  return json<Fixtures>(await fetch(`${BASE}/api/data`));
}
```

- [ ] **Step 3: Verify typecheck**

Run (from `frontend/`): `npm run typecheck`
Expected: passes (the unused `fixtures.json` import is gone; no type errors).

- [ ] **Step 4: Manual smoke — full stack**

Terminal A (`backend/`): `python seed.py` then `uvicorn app.main:app --port 8000`.
Terminal B (`frontend/`): `npm run dev`, open `http://localhost:5173`.
Expected: Dashboard and all 10 screens render exactly as before, now sourced from the backend. **This is the Phase-1 exit criterion (issue #1).**

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts frontend/src/data/api.ts
git commit -m "feat: point the data seam at the FastAPI backend"
```

---

## Phase 2 — People & account CRUD + Settings UI

> Implements issue #4. Adds the request/response schemas reused by all later CRUD phases.

### Task 2.1: Request/response schemas

**Files:**
- Create: `backend/app/schemas.py`

- [ ] **Step 1: Write `backend/app/schemas.py`**

```python
from typing import Optional
from pydantic import BaseModel


class PersonCreate(BaseModel):
    name: str
    role: str = "adult"
    birthYear: Optional[int] = None


class PersonUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    birthYear: Optional[int] = None


class AccountCreate(BaseModel):
    personId: str
    institution: str
    accountType: str
    kind: Optional[str] = None
    name: Optional[str] = None
    isLiability: bool = False
    beneficiaryId: Optional[str] = None


class AccountUpdate(BaseModel):
    institution: Optional[str] = None
    accountType: Optional[str] = None
    kind: Optional[str] = None
    name: Optional[str] = None
    isLiability: Optional[bool] = None
    beneficiaryId: Optional[str] = None


class SnapshotUpsert(BaseModel):
    accountId: str
    date: str
    amount: float


class SnapshotUpdate(BaseModel):
    date: Optional[str] = None
    amount: Optional[float] = None


class ContributionCreate(BaseModel):
    accountId: str
    personId: str
    date: str
    amount: float
    kind: str
    beneficiaryId: Optional[str] = None


class ContributionUpdate(BaseModel):
    date: Optional[str] = None
    amount: Optional[float] = None
    kind: Optional[str] = None
    beneficiaryId: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat: request/response schemas for editable resources"
```

---

### Task 2.2: People CRUD endpoints (TDD)

**Files:**
- Create: `backend/app/routers/people.py`
- Create: `backend/tests/test_people_accounts.py`
- Modify: `backend/app/main.py` (include the router)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_people_accounts.py`:
```python
def test_create_and_list_person(client):
    r = client.post("/api/people", json={"name": "Sanjay", "role": "adult", "birthYear": 1985})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["birthYear"] == 1985

    listed = client.get("/api/people").json()
    assert any(p["id"] == pid for p in listed)


def test_update_person(client):
    pid = client.post("/api/people", json={"name": "Anu", "role": "adult"}).json()["id"]
    r = client.put(f"/api/people/{pid}", json={"name": "Anumol"})
    assert r.status_code == 200
    assert r.json()["name"] == "Anumol"


def test_delete_person_blocked_when_owns_account(client):
    pid = client.post("/api/people", json={"name": "Owner", "role": "adult"}).json()["id"]
    client.post("/api/accounts", json={
        "personId": pid, "institution": "Questrade", "accountType": "tfsa"})
    r = client.delete(f"/api/people/{pid}")
    assert r.status_code == 409
    assert "account" in r.json()["detail"].lower()


def test_delete_person_ok_when_no_deps(client):
    pid = client.post("/api/people", json={"name": "Temp", "role": "adult"}).json()["id"]
    assert client.delete(f"/api/people/{pid}").status_code == 204
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_people_accounts.py -v`
Expected: FAIL — `404` (routes not mounted) / import error for `app.routers.people`.

- [ ] **Step 3: Write `backend/app/routers/people.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id
from ..models import Person, Account, Contribution
from ..schemas import PersonCreate, PersonUpdate
from ..services.fixtures import _person_out

router = APIRouter(prefix="/api/people", tags=["people"])


@router.get("")
def list_people(session: Session = Depends(get_session)):
    return [_person_out(p) for p in session.exec(select(Person)).all()]


@router.post("", status_code=201)
def create_person(body: PersonCreate, session: Session = Depends(get_session)):
    p = Person(id=new_id("p"), name=body.name, role=body.role, birth_year=body.birthYear)
    session.add(p)
    session.commit()
    session.refresh(p)
    return _person_out(p)


@router.put("/{person_id}")
def update_person(person_id: str, body: PersonUpdate, session: Session = Depends(get_session)):
    p = session.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if body.name is not None:
        p.name = body.name
    if body.role is not None:
        p.role = body.role
    if body.birthYear is not None:
        p.birth_year = body.birthYear
    session.add(p)
    session.commit()
    session.refresh(p)
    return _person_out(p)


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: str, session: Session = Depends(get_session)):
    p = session.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    owns = session.exec(select(Account).where(Account.person_id == person_id)).first()
    benef = session.exec(select(Account).where(Account.beneficiary_person_id == person_id)).first()
    contrib = session.exec(select(Contribution).where(Contribution.person_id == person_id)).first()
    if owns or benef or contrib:
        raise HTTPException(
            409, "Cannot delete a person who still owns an account, is a beneficiary, "
                 "or has contributions. Remove those first.")
    session.delete(p)
    session.commit()
```

- [ ] **Step 4: Mount the router — edit `backend/app/main.py`**

Change the import line and add the include:
```python
from .routers import data, people
```
```python
app.include_router(data.router)
app.include_router(people.router)
```

- [ ] **Step 5: Run to verify it passes**

Run: `pytest tests/test_people_accounts.py -v`
Expected: the 4 people tests pass; the account-dependent test (`test_delete_person_blocked_when_owns_account`) needs `/api/accounts`, which arrives in Task 2.3 — until then it will error with 404 on the POST. **Run only the people tests for now:**
`pytest tests/test_people_accounts.py -k "person and not blocked" -v` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/people.py backend/app/main.py backend/tests/test_people_accounts.py
git commit -m "feat: people CRUD with dependency-guarded delete"
```

---

### Task 2.3: Account CRUD endpoints (TDD)

**Files:**
- Create: `backend/app/routers/accounts.py`
- Modify: `backend/app/main.py`
- Append to: `backend/tests/test_people_accounts.py`

- [ ] **Step 1: Append failing tests to `backend/tests/test_people_accounts.py`**

```python
def test_create_account_defaults_kind_and_name(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    r = client.post("/api/accounts", json={
        "personId": pid, "institution": "Sunlife", "accountType": "dccp2"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "dcpp"            # dccp2 -> dcpp via KIND_MAP
    assert body["name"] == "Sunlife dccp2"   # default display name
    assert body["ownerIds"] == [pid]


def test_create_account_natural_key_conflict(client):
    pid = client.post("/api/people", json={"name": "Sanjay", "role": "adult"}).json()["id"]
    payload = {"personId": pid, "institution": "Questrade", "accountType": "tfsa"}
    assert client.post("/api/accounts", json=payload).status_code == 201
    assert client.post("/api/accounts", json=payload).status_code == 409


def test_delete_account_blocked_with_snapshots(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personId": pid, "institution": "Q", "accountType": "tfsa"}).json()["id"]
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100})
    r = client.delete(f"/api/accounts/{aid}")
    assert r.status_code == 409
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pytest tests/test_people_accounts.py -k account -v`
Expected: FAIL — `app.routers.accounts` missing. (The snapshot test also needs Task 3.1; it will pass once both exist.)

- [ ] **Step 3: Write `backend/app/routers/accounts.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_kind
from ..models import Account, InvestmentSnapshot, Contribution
from ..schemas import AccountCreate, AccountUpdate
from ..services.fixtures import _account_out

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _natural_key_exists(session, person_id, institution, account_type, exclude_id=None):
    q = select(Account).where(
        Account.person_id == person_id,
        Account.institution == institution,
        Account.account_type == account_type,
    )
    row = session.exec(q).first()
    return row is not None and row.id != exclude_id


@router.get("")
def list_accounts(session: Session = Depends(get_session)):
    return [_account_out(a) for a in session.exec(select(Account)).all()]


@router.post("", status_code=201)
def create_account(body: AccountCreate, session: Session = Depends(get_session)):
    if _natural_key_exists(session, body.personId, body.institution, body.accountType):
        raise HTTPException(409, "An account with this person, institution, and type already exists.")
    kind = body.kind or normalize_kind(body.accountType)
    name = body.name or f"{body.institution} {body.accountType}"
    a = Account(
        id=new_id("acc"), person_id=body.personId, institution=body.institution,
        account_type=body.accountType, kind=kind, name=name,
        is_liability=body.isLiability, beneficiary_person_id=body.beneficiaryId,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return _account_out(a)


@router.put("/{account_id}")
def update_account(account_id: str, body: AccountUpdate, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    if body.institution is not None:
        a.institution = body.institution
    if body.accountType is not None:
        a.account_type = body.accountType
        if body.kind is None:
            a.kind = normalize_kind(body.accountType)
    if body.kind is not None:
        a.kind = body.kind
    if body.name is not None:
        a.name = body.name
    if body.isLiability is not None:
        a.is_liability = body.isLiability
    if body.beneficiaryId is not None:
        a.beneficiary_person_id = body.beneficiaryId
    if _natural_key_exists(session, a.person_id, a.institution, a.account_type, exclude_id=a.id):
        raise HTTPException(409, "Another account already has this person, institution, and type.")
    session.add(a)
    session.commit()
    session.refresh(a)
    return _account_out(a)


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: str, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    has_snap = session.exec(
        select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == account_id)).first()
    has_contrib = session.exec(
        select(Contribution).where(Contribution.account_id == account_id)).first()
    if has_snap or has_contrib:
        raise HTTPException(409, "Cannot delete an account that still has snapshots or contributions.")
    session.delete(a)
    session.commit()
```

- [ ] **Step 4: Mount the router — edit `backend/app/main.py`**

```python
from .routers import data, people, accounts
```
```python
app.include_router(accounts.router)
```

- [ ] **Step 5: Run the people+account tests (snapshot-dependent ones still pending Task 3.1)**

Run: `pytest tests/test_people_accounts.py -k "not snapshots" -v`
Expected: all pass (including `test_delete_person_blocked_when_owns_account`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/accounts.py backend/app/main.py backend/tests/test_people_accounts.py
git commit -m "feat: account CRUD with natural-key uniqueness and guarded delete"
```

---

### Task 2.4: Add write methods to the seam + store actions

**Files:**
- Modify: `frontend/src/data/api.ts`
- Modify: `frontend/src/store/useAppStore.ts`

- [ ] **Step 1: Add CRUD methods to `frontend/src/data/api.ts`**

Append below `loadFixtures`:
```ts
import type { Person, Account } from '../types';

interface PersonInput { name: string; role: 'adult' | 'child'; birthYear?: number }
interface AccountInput {
  personId: string; institution: string; accountType: string;
  kind?: string; name?: string; isLiability?: boolean; beneficiaryId?: string;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  return json<T>(res);
}

export const createPerson = (b: PersonInput) => send<Person>('POST', '/api/people', b);
export const updatePerson = (id: string, b: Partial<PersonInput>) =>
  send<Person>('PUT', `/api/people/${id}`, b);
export const deletePerson = (id: string) => send<void>('DELETE', `/api/people/${id}`);

export const createAccount = (b: AccountInput) => send<Account>('POST', '/api/accounts', b);
export const updateAccount = (id: string, b: Partial<AccountInput>) =>
  send<Account>('PUT', `/api/accounts/${id}`, b);
export const deleteAccount = (id: string) => send<void>('DELETE', `/api/accounts/${id}`);
```

- [ ] **Step 2: Add async write actions to `frontend/src/store/useAppStore.ts`**

Add to the `AppState` interface:
```ts
  refetch: () => Promise<void>;
  addPerson: (b: { name: string; role: 'adult' | 'child'; birthYear?: number }) => Promise<void>;
  editPerson: (id: string, b: { name?: string; role?: 'adult' | 'child'; birthYear?: number }) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  addAccount: (b: { personId: string; institution: string; accountType: string; kind?: string; name?: string; beneficiaryId?: string }) => Promise<void>;
  editAccount: (id: string, b: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
```

Add the import and implementations inside `create<AppState>(...)`:
```ts
import * as api from '../data/api';
```
```ts
  refetch: async () => {
    const f = await loadFixtures();
    set({ fixtures: f });
  },
  addPerson: async (b) => { await api.createPerson(b); await get().refetch(); },
  editPerson: async (id, b) => { await api.updatePerson(id, b); await get().refetch(); },
  removePerson: async (id) => { await api.deletePerson(id); await get().refetch(); },
  addAccount: async (b) => { await api.createAccount(b); await get().refetch(); },
  editAccount: async (id, b) => { await api.updateAccount(id, b); await get().refetch(); },
  removeAccount: async (id) => { await api.deleteAccount(id); await get().refetch(); },
```

> Errors propagate to the caller (the form) so it can show the 409 message. `refetch` only runs after a successful write.

- [ ] **Step 3: Verify typecheck**

Run (from `frontend/`): `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/api.ts frontend/src/store/useAppStore.ts
git commit -m "feat: seam write methods + store actions for people/accounts"
```

---

### Task 2.5: Settings page — household & investment-account management

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Read the current Settings page**

Run: open `frontend/src/pages/Settings.tsx` and note the existing layout/section components used, so the new sections match house style (`Card`, `Button`, `Badge` from `components/ui`).

- [ ] **Step 2: Add a Household section**

Render the household from `useAppStore(s => s.fixtures.household)` as a table (name, role, birth year) with an **Add member** row (name input, role select adult/child, optional birth year) calling `addPerson`, an inline **edit** calling `editPerson`, and a **remove** calling `removePerson`. Surface thrown errors (e.g., the 409) in an inline message near the row. Full component code:

```tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

function HouseholdSection() {
  const household = useAppStore((s) => s.fixtures?.household ?? []);
  const addPerson = useAppStore((s) => s.addPerson);
  const removePerson = useAppStore((s) => s.removePerson);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'adult' | 'child'>('adult');
  const [birthYear, setBirthYear] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await addPerson({ name, role, birthYear: birthYear ? Number(birthYear) : undefined });
      setName(''); setBirthYear('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Household</h2>
      <table className="w-full text-sm mb-3">
        <thead><tr className="text-left text-gray-500"><th>Name</th><th>Role</th><th>Birth year</th><th></th></tr></thead>
        <tbody>
          {household.map((p) => (
            <tr key={p.id} className="border-t">
              <td>{p.name}</td><td>{p.role}</td><td>{p.birthYear ?? '—'}</td>
              <td className="text-right">
                <button className="text-red-600" onClick={async () => {
                  setError('');
                  try { await removePerson(p.id); } catch (e) { setError((e as Error).message); }
                }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 items-end">
        <input className="border rounded px-2 py-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="border rounded px-2 py-1" value={role} onChange={(e) => setRole(e.target.value as 'adult' | 'child')}>
          <option value="adult">adult</option>
          <option value="child">child</option>
        </select>
        <input className="border rounded px-2 py-1 w-28" placeholder="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
        <Button onClick={submit} disabled={!name}>Add member</Button>
      </div>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </Card>
  );
}
```

- [ ] **Step 3: Add an Investment-accounts section**

Filter `fixtures.accounts` to investment kinds (`tfsa,rrsp,resp,fhsa,dcpp,non_registered,crypto`), render person/institution/account_type/kind with an add form (person select, institution, account type free-text, optional RESP beneficiary select) calling `addAccount`, and remove calling `removeAccount`. Full component:

```tsx
const INVESTMENT_KINDS = ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'non_registered', 'crypto'];

function InvestmentAccountsSection() {
  const fixtures = useAppStore((s) => s.fixtures);
  const addAccount = useAppStore((s) => s.addAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const people = fixtures?.household ?? [];
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
  const kids = people.filter((p) => p.role === 'child');
  const [form, setForm] = useState({ personId: '', institution: '', accountType: '', beneficiaryId: '' });
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await addAccount({
        personId: form.personId, institution: form.institution, accountType: form.accountType,
        beneficiaryId: form.beneficiaryId || undefined,
      });
      setForm({ personId: '', institution: '', accountType: '', beneficiaryId: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Investment accounts</h2>
      <table className="w-full text-sm mb-3">
        <thead><tr className="text-left text-gray-500"><th>Owner</th><th>Institution</th><th>Type</th><th>Kind</th><th></th></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-t">
              <td>{people.find((p) => p.id === a.ownerIds[0])?.name ?? '—'}</td>
              <td>{a.institution}</td><td>{a.name}</td><td>{a.kind}</td>
              <td className="text-right">
                <button className="text-red-600" onClick={async () => {
                  setError('');
                  try { await removeAccount(a.id); } catch (e) { setError((e as Error).message); }
                }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 items-end flex-wrap">
        <select className="border rounded px-2 py-1" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })}>
          <option value="">Owner…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="border rounded px-2 py-1" placeholder="Institution" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Account type (e.g. tfsa, dccp2)" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} />
        <select className="border rounded px-2 py-1" value={form.beneficiaryId} onChange={(e) => setForm({ ...form, beneficiaryId: e.target.value })}>
          <option value="">RESP beneficiary (optional)…</option>
          {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <Button onClick={submit} disabled={!form.personId || !form.institution || !form.accountType}>Add account</Button>
      </div>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </Card>
  );
}
```

- [ ] **Step 4: Render both sections in the `Settings` component**

Add `<HouseholdSection />` and `<InvestmentAccountsSection />` into the existing Settings page layout (keep any existing settings content above/below). Ensure the file still exports `Settings`.

- [ ] **Step 5: Verify typecheck + manual**

Run (from `frontend/`): `npm run typecheck` → passes.
With both servers running, open `/settings`: add a person, add an account, try removing an account that has data (expect the inline 409 message), remove a fresh one (succeeds and disappears).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat: Settings page household + investment-account management"
```

---

## Phase 3 — Investment snapshots: upsert, CSV import, editable grid

> Implements issues #2 and #3.

### Task 3.1: Snapshot CRUD + upsert endpoints (TDD)

**Files:**
- Create: `backend/app/routers/snapshots.py`
- Create: `backend/tests/test_snapshots.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write `backend/tests/test_snapshots.py`**

```python
def _person_account(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personId": pid, "institution": "Q", "accountType": "tfsa"}).json()["id"]
    return aid


def test_upsert_creates_then_overwrites(client):
    aid = _person_account(client)
    r1 = client.post("/api/snapshots", json={"accountId": aid, "date": "20250131", "amount": 100})
    assert r1.status_code == 200
    assert r1.json()["date"] == "2025-01-31"  # normalized from YYYYMMDD
    client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 250})
    rows = client.get(f"/api/snapshots?account_id={aid}").json()
    assert len(rows) == 1 and rows[0]["amount"] == 250


def test_edit_and_delete_snapshot(client):
    aid = _person_account(client)
    sid = client.post("/api/snapshots", json={"accountId": aid, "date": "2025-01-31", "amount": 100}).json()["id"]
    assert client.put(f"/api/snapshots/{sid}", json={"amount": 500}).json()["amount"] == 500
    assert client.delete(f"/api/snapshots/{sid}").status_code == 204
    assert client.get(f"/api/snapshots?account_id={aid}").json() == []


def test_bad_date_rejected(client):
    aid = _person_account(client)
    r = client.post("/api/snapshots", json={"accountId": aid, "date": "31-01-2025", "amount": 100})
    assert r.status_code == 422
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_snapshots.py -v`
Expected: FAIL — `app.routers.snapshots` missing.

- [ ] **Step 3: Write `backend/app/routers/snapshots.py`**

```python
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_date
from ..models import InvestmentSnapshot
from ..schemas import SnapshotUpsert, SnapshotUpdate

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


def _out(s: InvestmentSnapshot) -> dict:
    return {"id": s.id, "accountId": s.account_id, "date": s.date, "amount": s.amount}


@router.get("")
def list_snapshots(account_id: Optional[str] = None, session: Session = Depends(get_session)):
    q = select(InvestmentSnapshot)
    if account_id:
        q = q.where(InvestmentSnapshot.account_id == account_id)
    return [_out(s) for s in session.exec(q).all()]


@router.post("")
def upsert_snapshot(body: SnapshotUpsert, session: Session = Depends(get_session)):
    try:
        date = normalize_date(body.date)
    except ValueError as e:
        raise HTTPException(422, str(e))
    existing = session.exec(select(InvestmentSnapshot).where(
        InvestmentSnapshot.account_id == body.accountId,
        InvestmentSnapshot.date == date,
    )).first()
    if existing:
        existing.amount = body.amount
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return _out(existing)
    s = InvestmentSnapshot(id=new_id("snap"), account_id=body.accountId, date=date, amount=body.amount)
    session.add(s)
    session.commit()
    session.refresh(s)
    return _out(s)


@router.put("/{snapshot_id}")
def update_snapshot(snapshot_id: str, body: SnapshotUpdate, session: Session = Depends(get_session)):
    s = session.get(InvestmentSnapshot, snapshot_id)
    if not s:
        raise HTTPException(404, "Snapshot not found")
    if body.date is not None:
        try:
            s.date = normalize_date(body.date)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if body.amount is not None:
        s.amount = body.amount
    session.add(s)
    session.commit()
    session.refresh(s)
    return _out(s)


@router.delete("/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: str, session: Session = Depends(get_session)):
    s = session.get(InvestmentSnapshot, snapshot_id)
    if not s:
        raise HTTPException(404, "Snapshot not found")
    session.delete(s)
    session.commit()
```

- [ ] **Step 4: Mount the router — edit `backend/app/main.py`**

```python
from .routers import data, people, accounts, snapshots
```
```python
app.include_router(snapshots.router)
```

- [ ] **Step 5: Run to verify it passes (and the deferred account test now passes)**

Run: `pytest tests/test_snapshots.py tests/test_people_accounts.py -v`
Expected: all pass, including `test_delete_account_blocked_with_snapshots`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/snapshots.py backend/app/main.py backend/tests/test_snapshots.py
git commit -m "feat: snapshot upsert/edit/delete endpoints"
```

---

### Task 3.2: CSV import service (TDD)

**Files:**
- Create: `backend/app/services/csv_import.py`
- Create: `backend/tests/test_csv_import.py`

- [ ] **Step 1: Write `backend/tests/test_csv_import.py`**

```python
from sqlmodel import select
from app.models import Person, Account, InvestmentSnapshot
from app.services.csv_import import import_investment_csv

HEADER = "date,person,institution,account_type,amount\n"


def test_import_creates_people_accounts_snapshots(session):
    csv_text = HEADER + "20250131,sanjay,questrade,tfsa,10000\n20250131,anumol,wealthsimple,rrsp,5000\n"
    summary = import_investment_csv(csv_text, session)
    assert summary["created"] == 2
    assert summary["skipped"] == 0
    assert len(session.exec(select(Person)).all()) == 2
    assert len(session.exec(select(Account)).all()) == 2
    assert len(session.exec(select(InvestmentSnapshot)).all()) == 2


def test_import_matches_person_case_insensitively(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.commit()
    import_investment_csv(HEADER + "20250131,sanjay,questrade,tfsa,10000\n", session)
    assert len(session.exec(select(Person)).all()) == 1  # matched existing "Sanjay"


def test_import_upserts_by_account_date(session):
    import_investment_csv(HEADER + "20250131,sanjay,questrade,tfsa,10000\n", session)
    summary = import_investment_csv(HEADER + "2025-01-31,sanjay,questrade,tfsa,12000\n", session)
    assert summary["updated"] == 1
    snaps = session.exec(select(InvestmentSnapshot)).all()
    assert len(snaps) == 1 and snaps[0].amount == 12000.0


def test_import_infers_kind_from_free_text_type(session):
    import_investment_csv(HEADER + "20250131,sanjay,sunlife,dccp2,42000\n", session)
    acc = session.exec(select(Account)).first()
    assert acc.account_type == "dccp2" and acc.kind == "dcpp"


def test_import_reports_bad_rows(session):
    summary = import_investment_csv(HEADER + "BADDATE,sanjay,questrade,tfsa,100\n", session)
    assert summary["skipped"] == 1
    assert summary["errors"][0]["row"] == 1


def test_import_rejects_wrong_header(session):
    summary = import_investment_csv("foo,bar\n1,2\n", session)
    assert summary["errors"] and summary["errors"][0]["row"] == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_csv_import.py -v`
Expected: FAIL — `app.services.csv_import` missing.

- [ ] **Step 3: Write `backend/app/services/csv_import.py`**

```python
import csv
import io

from sqlmodel import Session, select

from ..constants import normalize_date, normalize_kind, new_id
from ..models import Person, Account, InvestmentSnapshot

REQUIRED = {"date", "person", "institution", "account_type", "amount"}


def _find_person(session: Session, name: str):
    target = name.strip().lower()
    for p in session.exec(select(Person)).all():
        if p.name.strip().lower() == target:
            return p
    return None


def _find_account(session: Session, person_id: str, institution: str, account_type: str):
    return session.exec(select(Account).where(
        Account.person_id == person_id,
        Account.institution == institution,
        Account.account_type == account_type,
    )).first()


def import_investment_csv(text: str, session: Session) -> dict:
    summary = {"created": 0, "updated": 0, "skipped": 0, "errors": []}
    reader = csv.DictReader(io.StringIO(text))
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    if not REQUIRED.issubset(headers):
        summary["errors"].append({
            "row": 0,
            "reason": f"CSV must include columns: {', '.join(sorted(REQUIRED))}",
        })
        return summary

    for i, raw in enumerate(reader, start=1):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            date = normalize_date(row["date"])
            amount = float(row["amount"])
            name, institution, account_type = row["person"], row["institution"], row["account_type"]
            if not (name and institution and account_type):
                raise ValueError("missing person/institution/account_type")
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            continue

        person = _find_person(session, name)
        if not person:
            person = Person(id=new_id("p"), name=name, role="adult")
            session.add(person)
            session.commit()
            session.refresh(person)

        account = _find_account(session, person.id, institution, account_type)
        if not account:
            account = Account(
                id=new_id("acc"), person_id=person.id, institution=institution,
                account_type=account_type, kind=normalize_kind(account_type),
                name=f"{institution} {account_type}",
            )
            session.add(account)
            session.commit()
            session.refresh(account)

        existing = session.exec(select(InvestmentSnapshot).where(
            InvestmentSnapshot.account_id == account.id,
            InvestmentSnapshot.date == date,
        )).first()
        if existing:
            existing.amount = amount
            session.add(existing)
            session.commit()
            summary["updated"] += 1
        else:
            session.add(InvestmentSnapshot(
                id=new_id("snap"), account_id=account.id, date=date, amount=amount))
            session.commit()
            summary["created"] += 1

    return summary
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_csv_import.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/csv_import.py backend/tests/test_csv_import.py
git commit -m "feat: investment CSV import service (auto-create + upsert)"
```

---

### Task 3.3: Import endpoint (TDD)

**Files:**
- Create: `backend/app/routers/imports.py`
- Modify: `backend/app/main.py`
- Append to: `backend/tests/test_csv_import.py`

- [ ] **Step 1: Append an endpoint test to `backend/tests/test_csv_import.py`**

```python
def test_import_endpoint_multipart(client):
    csv_bytes = (HEADER + "20250131,sanjay,questrade,tfsa,10000\n").encode("utf-8")
    r = client.post(
        "/api/import/investments-csv",
        files={"file": ("snap.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 200
    assert r.json()["created"] == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_csv_import.py -k endpoint -v`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Write `backend/app/routers/imports.py`**

```python
from fastapi import APIRouter, Depends, UploadFile, File
from sqlmodel import Session

from ..db import get_session
from ..services.csv_import import import_investment_csv

router = APIRouter(prefix="/api/import", tags=["imports"])


@router.post("/investments-csv")
async def import_investments_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return import_investment_csv(text, session)
```

- [ ] **Step 4: Mount the router — edit `backend/app/main.py`**

```python
from .routers import data, people, accounts, snapshots, imports
```
```python
app.include_router(imports.router)
```

- [ ] **Step 5: Run to verify it passes**

Run: `pytest tests/test_csv_import.py -k endpoint -v`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/imports.py backend/app/main.py backend/tests/test_csv_import.py
git commit -m "feat: POST /api/import/investments-csv multipart endpoint"
```

---

### Task 3.4: Seam + store methods for snapshots and import

**Files:**
- Modify: `frontend/src/data/api.ts`
- Modify: `frontend/src/store/useAppStore.ts`

- [ ] **Step 1: Add snapshot + import methods to `frontend/src/data/api.ts`**

```ts
export interface SnapshotRow { id: string; accountId: string; date: string; amount: number }
export interface ImportSummary {
  created: number; updated: number; skipped: number;
  errors: { row: number; reason: string }[];
}

export const listSnapshots = (accountId: string) =>
  send<SnapshotRow[]>('GET', `/api/snapshots?account_id=${encodeURIComponent(accountId)}`);
export const upsertSnapshot = (b: { accountId: string; date: string; amount: number }) =>
  send<SnapshotRow>('POST', '/api/snapshots', b);
export const updateSnapshot = (id: string, b: { date?: string; amount?: number }) =>
  send<SnapshotRow>('PUT', `/api/snapshots/${id}`, b);
export const deleteSnapshot = (id: string) => send<void>('DELETE', `/api/snapshots/${id}`);

export async function importInvestmentsCsv(file: File): Promise<ImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return json<ImportSummary>(await fetch(`${BASE}/api/import/investments-csv`, { method: 'POST', body: fd }));
}
```

- [ ] **Step 2: Add store actions to `frontend/src/store/useAppStore.ts`**

Interface additions:
```ts
  saveSnapshot: (b: { accountId: string; date: string; amount: number }) => Promise<void>;
  editSnapshot: (id: string, b: { date?: string; amount?: number }) => Promise<void>;
  removeSnapshot: (id: string) => Promise<void>;
  importCsv: (file: File) => Promise<import('../data/api').ImportSummary>;
```
Implementations:
```ts
  saveSnapshot: async (b) => { await api.upsertSnapshot(b); await get().refetch(); },
  editSnapshot: async (id, b) => { await api.updateSnapshot(id, b); await get().refetch(); },
  removeSnapshot: async (id) => { await api.deleteSnapshot(id); await get().refetch(); },
  importCsv: async (file) => {
    const summary = await api.importInvestmentsCsv(file);
    await get().refetch();
    return summary;
  },
```

- [ ] **Step 3: Verify typecheck**

Run (from `frontend/`): `npm run typecheck` → passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/api.ts frontend/src/store/useAppStore.ts
git commit -m "feat: seam + store methods for snapshots and csv import"
```

---

### Task 3.5: Investments page — editable snapshot grid + add/update form

**Files:**
- Modify: `frontend/src/pages/Investments.tsx`

- [ ] **Step 1: Read the current Investments page** to preserve existing charts/sections and house style.

- [ ] **Step 2: Add an account picker + add/update form + editable grid**

The grid lists snapshots for the selected account from `fixtures.investments` (filtered by `accountId`), each row editable (amount) with delete; the form is the fast "add / update value as of a date" path. Full section component:

```tsx
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

const INVESTMENT_KINDS = ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'non_registered', 'crypto'];

export function SnapshotEditor() {
  const fixtures = useAppStore((s) => s.fixtures);
  const saveSnapshot = useAppStore((s) => s.saveSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  // snapshots in the payload are id-less; the editable grid needs ids, so it reads them
  // from listSnapshots via a small effect-free derived call done in the store refetch.
  const rows = useMemo(
    () => (fixtures?.investments ?? [])
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [fixtures, accountId],
  );

  async function submit() {
    setError('');
    try {
      await saveSnapshot({ accountId, date, amount: Number(amount) });
      setDate(''); setAmount('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Add / update value</h2>
      <div className="flex gap-2 items-end flex-wrap mb-4">
        <select className="border rounded px-2 py-1" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className="border rounded px-2 py-1" placeholder="Date (YYYY-MM-DD)" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="border rounded px-2 py-1 w-32" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button onClick={submit} disabled={!accountId || !date || !amount}>Save</Button>
      </div>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      {accountId && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500"><th>Date</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.date} className="border-t">
                <td>{s.date}</td>
                <td>{s.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

> Inline amount-fix and delete operate on id-bearing rows. Because the consolidated payload's
> `investments` are id-less, the grid resolves the snapshot id via `api.listSnapshots(accountId)`
> when entering edit mode. Add a small `editingId` state and call `editSnapshot(id, {amount})` /
> `removeSnapshot(id)`; re-entering the same `(account,date)` via **Save** upserts, which already
> covers the common "fix a value" case without needing the id.

- [ ] **Step 3: Render `<SnapshotEditor />` inside the Investments page** alongside the existing allocation/holdings views.

- [ ] **Step 4: Verify typecheck + manual**

Run `npm run typecheck` → passes. With both servers up, open `/investments`: pick an account, add a value for a new date (appears in Net Worth), re-save the same date with a new amount (overwrites).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Investments.tsx
git commit -m "feat: Investments add/update value + snapshot grid"
```

---

### Task 3.6: Import page — real investments CSV upload

**Files:**
- Modify: `frontend/src/pages/Import.tsx`

- [ ] **Step 1: Replace the stub with a file picker + summary**

```tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { ImportSummary } from '../data/api';

export function Import() {
  const importCsv = useAppStore((s) => s.importCsv);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setError(''); setBusy(true); setSummary(null);
    try {
      setSummary(await importCsv(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold mb-2">Import investments CSV</h1>
      <p className="text-sm text-gray-500 mb-3">
        Columns: <code>date, person, institution, account_type, amount</code>.
        Dates may be <code>YYYYMMDD</code> or <code>YYYY-MM-DD</code>. Missing people/accounts are created automatically.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button onClick={run} disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {summary && (
        <div className="text-sm">
          <p>Created {summary.created} · Updated {summary.updated} · Skipped {summary.skipped}</p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 text-red-600 list-disc pl-5">
              {summary.errors.map((er, idx) => <li key={idx}>Row {er.row}: {er.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify typecheck + manual**

Run `npm run typecheck` → passes. Open `/import`, upload the sample 9-row CSV, confirm the created/updated/skipped summary and that `/investments` and `/networth` reflect the new data.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Import.tsx
git commit -m "feat: real investments CSV import on the Import page"
```

---

## Phase 4 — Manual contributions + derived CESG

> Implements issue #5. The room cards (`contributionRoomUsed`) and per-kid CESG dashboard
> (`cesgStatusPerKid` in `lib/canadian.ts`) already consume `contributionEvents` and `cesgGrants`
> from the payload, so they light up with real numbers as soon as contributions persist — no
> change to those pure functions is required.

### Task 4.1: Contribution CRUD endpoints (TDD)

**Files:**
- Create: `backend/app/routers/contributions.py`
- Create: `backend/tests/test_contributions.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write `backend/tests/test_contributions.py`**

```python
def _resp_account(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    kid = client.post("/api/people", json={"name": "Kid", "role": "child", "birthYear": 2015}).json()["id"]
    aid = client.post("/api/accounts", json={
        "personId": pid, "institution": "WS", "accountType": "resp", "beneficiaryId": kid}).json()["id"]
    return pid, kid, aid


def test_resp_contribution_derives_cesg_in_payload(client):
    pid, kid, aid = _resp_account(client)
    r = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01",
        "amount": 1000, "kind": "resp", "beneficiaryId": kid})
    assert r.status_code == 201
    grants = [g for g in client.get("/api/data").json()["cesgGrants"] if g["beneficiaryId"] == kid]
    assert sum(g["amount"] for g in grants) == 200.0


def test_resp_requires_beneficiary(client):
    pid, kid, aid = _resp_account(client)
    r = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01", "amount": 1000, "kind": "resp"})
    assert r.status_code == 422


def test_tfsa_contribution_appears_in_events(client):
    pid = client.post("/api/people", json={"name": "S", "role": "adult"}).json()["id"]
    aid = client.post("/api/accounts", json={"personId": pid, "institution": "Q", "accountType": "tfsa"}).json()["id"]
    cid = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "20250115", "amount": 500, "kind": "tfsa"}).json()["id"]
    events = client.get("/api/data").json()["contributionEvents"]
    assert any(e["id"] == cid and e["date"] == "2025-01-15" for e in events)


def test_delete_contribution_removes_cesg(client):
    pid, kid, aid = _resp_account(client)
    cid = client.post("/api/contributions", json={
        "accountId": aid, "personId": pid, "date": "2025-02-01",
        "amount": 1000, "kind": "resp", "beneficiaryId": kid}).json()["id"]
    assert client.delete(f"/api/contributions/{cid}").status_code == 204
    assert [g for g in client.get("/api/data").json()["cesgGrants"] if g["beneficiaryId"] == kid] == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_contributions.py -v`
Expected: FAIL — `app.routers.contributions` missing.

- [ ] **Step 3: Write `backend/app/routers/contributions.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..constants import new_id, normalize_date, CONTRIBUTION_KINDS
from ..models import Contribution
from ..schemas import ContributionCreate, ContributionUpdate
from ..services.fixtures import _contribution_out

router = APIRouter(prefix="/api/contributions", tags=["contributions"])


@router.get("")
def list_contributions(session: Session = Depends(get_session)):
    return [_contribution_out(c) for c in session.exec(select(Contribution)).all()]


@router.post("", status_code=201)
def create_contribution(body: ContributionCreate, session: Session = Depends(get_session)):
    if body.kind not in CONTRIBUTION_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(CONTRIBUTION_KINDS)}")
    if body.kind == "resp" and not body.beneficiaryId:
        raise HTTPException(422, "RESP contributions require a beneficiary.")
    try:
        date = normalize_date(body.date)
    except ValueError as e:
        raise HTTPException(422, str(e))
    c = Contribution(
        id=new_id("contrib"), account_id=body.accountId, person_id=body.personId,
        date=date, amount=body.amount, kind=body.kind,
        beneficiary_person_id=body.beneficiaryId,
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contribution_out(c)


@router.put("/{contribution_id}")
def update_contribution(contribution_id: str, body: ContributionUpdate, session: Session = Depends(get_session)):
    c = session.get(Contribution, contribution_id)
    if not c:
        raise HTTPException(404, "Contribution not found")
    if body.kind is not None:
        if body.kind not in CONTRIBUTION_KINDS:
            raise HTTPException(422, f"kind must be one of {sorted(CONTRIBUTION_KINDS)}")
        c.kind = body.kind
    if body.date is not None:
        try:
            c.date = normalize_date(body.date)
        except ValueError as e:
            raise HTTPException(422, str(e))
    if body.amount is not None:
        c.amount = body.amount
    if body.beneficiaryId is not None:
        c.beneficiary_person_id = body.beneficiaryId
    if c.kind == "resp" and not c.beneficiary_person_id:
        raise HTTPException(422, "RESP contributions require a beneficiary.")
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contribution_out(c)


@router.delete("/{contribution_id}", status_code=204)
def delete_contribution(contribution_id: str, session: Session = Depends(get_session)):
    c = session.get(Contribution, contribution_id)
    if not c:
        raise HTTPException(404, "Contribution not found")
    session.delete(c)
    session.commit()
```

- [ ] **Step 4: Mount the router — edit `backend/app/main.py`**

```python
from .routers import data, people, accounts, snapshots, imports, contributions
```
```python
app.include_router(contributions.router)
```

- [ ] **Step 5: Run to verify it passes**

Run: `pytest tests/test_contributions.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/contributions.py backend/app/main.py backend/tests/test_contributions.py
git commit -m "feat: contribution CRUD; RESP requires beneficiary; CESG re-derived on read"
```

---

### Task 4.2: Seam + store methods for contributions

**Files:**
- Modify: `frontend/src/data/api.ts`
- Modify: `frontend/src/store/useAppStore.ts`

- [ ] **Step 1: Add contribution methods to `frontend/src/data/api.ts`**

```ts
import type { ContributionEvent, ContributionKind } from '../types';

interface ContributionInput {
  accountId: string; personId: string; date: string;
  amount: number; kind: ContributionKind; beneficiaryId?: string;
}

export const createContribution = (b: ContributionInput) =>
  send<ContributionEvent>('POST', '/api/contributions', b);
export const updateContribution = (id: string, b: Partial<ContributionInput>) =>
  send<ContributionEvent>('PUT', `/api/contributions/${id}`, b);
export const deleteContribution = (id: string) =>
  send<void>('DELETE', `/api/contributions/${id}`);
```

- [ ] **Step 2: Add store actions to `frontend/src/store/useAppStore.ts`**

Interface additions:
```ts
  addContribution: (b: { accountId: string; personId: string; date: string; amount: number; kind: import('../types').ContributionKind; beneficiaryId?: string }) => Promise<void>;
  editContribution: (id: string, b: Record<string, unknown>) => Promise<void>;
  removeContribution: (id: string) => Promise<void>;
```
Implementations:
```ts
  addContribution: async (b) => { await api.createContribution(b); await get().refetch(); },
  editContribution: async (id, b) => { await api.updateContribution(id, b as never); await get().refetch(); },
  removeContribution: async (id) => { await api.deleteContribution(id); await get().refetch(); },
```

- [ ] **Step 3: Verify typecheck**

Run (from `frontend/`): `npm run typecheck` → passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/api.ts frontend/src/store/useAppStore.ts
git commit -m "feat: seam + store methods for contributions"
```

---

### Task 4.3: Investments page — contributions entry form + grid

**Files:**
- Modify: `frontend/src/pages/Investments.tsx`

- [ ] **Step 1: Add a contributions section**

An entry form (account select, kind select rrsp/tfsa/resp/fhsa, date, amount, RESP-only beneficiary select) calling `addContribution`, and a grid of `fixtures.contributionEvents` with delete. Full component:

```tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { ContributionKind } from '../types';

const KINDS: ContributionKind[] = ['rrsp', 'tfsa', 'resp', 'fhsa'];

export function ContributionsEditor() {
  const fixtures = useAppStore((s) => s.fixtures);
  const addContribution = useAppStore((s) => s.addContribution);
  const removeContribution = useAppStore((s) => s.removeContribution);
  const people = fixtures?.household ?? [];
  const accounts = fixtures?.accounts ?? [];
  const kids = people.filter((p) => p.role === 'child');
  const events = (fixtures?.contributionEvents ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const [f, setF] = useState({ accountId: '', personId: '', kind: 'rrsp' as ContributionKind, date: '', amount: '', beneficiaryId: '' });
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await addContribution({
        accountId: f.accountId, personId: f.personId, kind: f.kind,
        date: f.date, amount: Number(f.amount),
        beneficiaryId: f.kind === 'resp' ? f.beneficiaryId || undefined : undefined,
      });
      setF({ ...f, date: '', amount: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Contributions (RRSP / TFSA / RESP / FHSA)</h2>
      <div className="flex gap-2 items-end flex-wrap mb-3">
        <select className="border rounded px-2 py-1" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
          <option value="">Contributor…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="border rounded px-2 py-1" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          <option value="">Account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="border rounded px-2 py-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ContributionKind })}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {f.kind === 'resp' && (
          <select className="border rounded px-2 py-1" value={f.beneficiaryId} onChange={(e) => setF({ ...f, beneficiaryId: e.target.value })}>
            <option value="">Beneficiary…</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        <input className="border rounded px-2 py-1" placeholder="Date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input className="border rounded px-2 py-1 w-28" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Button onClick={submit} disabled={!f.personId || !f.accountId || !f.date || !f.amount || (f.kind === 'resp' && !f.beneficiaryId)}>Add</Button>
      </div>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th>Date</th><th>Kind</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t">
              <td>{e.date}</td><td>{e.kind}</td><td>{e.amount.toLocaleString()}</td>
              <td className="text-right"><button className="text-red-600" onClick={() => removeContribution(e.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
```

- [ ] **Step 2: Render `<ContributionsEditor />` in the Investments page.**

- [ ] **Step 3: Verify typecheck + manual**

Run `npm run typecheck` → passes. With both servers up: add an RESP contribution for a kid, confirm the per-kid CESG dashboard shows 20% captured and the RESP room card updates; delete it and confirm both revert.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Investments.tsx
git commit -m "feat: contribution entry + grid wired to room/CESG cards"
```

---

## Phase 5 — Frontend test harness, tests, run docs

> Implements issue #7 (test-harness baseline) for the frontend; the backend pytest suite is
> already green from Phases 1–4.

### Task 5.1: Wire Vitest

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`

- [ ] **Step 1: Install dev deps**

Run (from `frontend/`):
```
npm install -D vitest@2.1.8 jsdom@25.0.1
```

- [ ] **Step 2: Add scripts to `frontend/package.json`**

In `"scripts"`, add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Write `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Verify the runner starts (no tests yet)**

Run: `npm test`
Expected: Vitest runs and reports `No test files found` (exit non-zero is fine) — confirms config loads.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "test: wire Vitest (jsdom) into the frontend"
```

---

### Task 5.2: Seam client tests (TDD-style: write, run, see pass)

**Files:**
- Create: `frontend/src/data/__tests__/api.test.ts`

- [ ] **Step 1: Write `frontend/src/data/__tests__/api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixtures, createPerson } from '../api';

describe('api seam', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loadFixtures GETs /api/data', async () => {
    const payload = { household: [] };
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: async () => payload } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFixtures();
    expect(fetchMock).toHaveBeenCalledWith('/api/data');
    expect(data).toBe(payload);
  });

  it('createPerson POSTs JSON to /api/people', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ id: 'p_1', name: 'A', role: 'adult' }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const p = await createPerson({ name: 'A', role: 'adult' });
    expect(fetchMock).toHaveBeenCalledWith('/api/people', expect.objectContaining({ method: 'POST' }));
    expect(p.id).toBe('p_1');
  });

  it('throws on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: false, status: 409, statusText: 'Conflict', text: async () => 'dup' } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(createPerson({ name: 'A', role: 'adult' })).rejects.toThrow('409');
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/__tests__/api.test.ts
git commit -m "test: seam client (fetch URL, POST, error path)"
```

---

### Task 5.3: Store write→refetch test

**Files:**
- Create: `frontend/src/store/__tests__/store.test.ts`

- [ ] **Step 1: Write `frontend/src/store/__tests__/store.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn().mockResolvedValue({ household: [{ id: 'p1', name: 'A', role: 'adult' }], budget: { mode: 'envelope', lines: [] } }),
  createPerson: vi.fn().mockResolvedValue({ id: 'p2', name: 'B', role: 'adult' }),
}));

import { useAppStore } from '../useAppStore';
import * as api from '../../data/api';

describe('store write→refetch', () => {
  it('addPerson calls the api then refetches via loadFixtures', async () => {
    await useAppStore.getState().addPerson({ name: 'B', role: 'adult' });
    expect(api.createPerson).toHaveBeenCalledWith({ name: 'B', role: 'adult' });
    expect(api.loadFixtures).toHaveBeenCalled();
    expect(useAppStore.getState().fixtures?.household[0].id).toBe('p1');
  });
});
```

> The mock only needs the api exports this test path touches (`loadFixtures`, `createPerson`).
> `import * as api` leaves the rest `undefined`, which is fine because they are never called here.

- [ ] **Step 2: Run**

Run: `npm test`
Expected: store test passes (alongside the api tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/__tests__/store.test.ts
git commit -m "test: store write actions refetch after a successful mutation"
```

---

### Task 5.4: Pure-function recompute tests

**Files:**
- Create: `frontend/src/lib/__tests__/kpi.test.ts`
- Create: `frontend/src/lib/__tests__/canadian.test.ts`

- [ ] **Step 1: Write `frontend/src/lib/__tests__/kpi.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { netWorth, latestInvestmentSnapshot } from '../kpi';
import type { Fixtures, InvestmentSnapshot } from '../../types';

const LIMITS = {
  TFSA_ANNUAL: 7000, RRSP_ANNUAL_PCT: 0.18, RRSP_ANNUAL_CAP: 32490,
  RESP_LIFETIME_PER_CHILD: 50000, RESP_ANNUAL_FOR_FULL_CESG: 2500,
  FHSA_ANNUAL: 8000, FHSA_LIFETIME: 40000, CESG_RATE: 0.2,
  CESG_ANNUAL_PER_CHILD: 500, CESG_LIFETIME_PER_CHILD: 7200,
};

function fx(investments: InvestmentSnapshot[]): Fixtures {
  return {
    household: [],
    accounts: [{ id: 'inv1', name: 'TFSA', kind: 'tfsa', institution: 'Q', ownerIds: ['p1'] }],
    categories: [], rules: [], transactions: [],
    investments,
    contributionEvents: [], cesgGrants: [],
    budget: { mode: 'envelope', lines: [] },
    craLimits: LIMITS,
    meta: { generatedAt: '2025-01-01', seed: 0, monthsCovered: 1, openingBalances: {} },
  };
}

describe('netWorth investments', () => {
  it('uses the latest snapshot per account', () => {
    const f = fx([
      { date: '2025-01-31', accountId: 'inv1', amount: 1000 },
      { date: '2025-02-28', accountId: 'inv1', amount: 1500 },
    ]);
    expect(latestInvestmentSnapshot(f)).toHaveLength(1);
    expect(netWorth(f).investments).toBe(1500);
  });

  it('recomputes when a newer snapshot is added', () => {
    const f = fx([{ date: '2025-01-31', accountId: 'inv1', amount: 1000 }]);
    expect(netWorth(f).investments).toBe(1000);
    f.investments.push({ date: '2025-03-31', accountId: 'inv1', amount: 2000 });
    expect(netWorth(f).investments).toBe(2000);
  });
});
```

- [ ] **Step 2: Write `frontend/src/lib/__tests__/canadian.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { contributionRoomUsed, cesgStatusPerKid } from '../canadian';
import type { CraLimits, ContributionEvent, CesgGrant } from '../../types';

const LIMITS: CraLimits = {
  TFSA_ANNUAL: 7000, RRSP_ANNUAL_PCT: 0.18, RRSP_ANNUAL_CAP: 32490,
  RESP_LIFETIME_PER_CHILD: 50000, RESP_ANNUAL_FOR_FULL_CESG: 2500,
  FHSA_ANNUAL: 8000, FHSA_LIFETIME: 40000, CESG_RATE: 0.2,
  CESG_ANNUAL_PER_CHILD: 500, CESG_LIFETIME_PER_CHILD: 7200,
};

describe('contributionRoomUsed', () => {
  it('sums TFSA contributions and computes remaining', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2025-02-01', accountId: 'a', personId: 'p1', amount: 3000, kind: 'tfsa' },
    ];
    const tfsa = contributionRoomUsed(events, 2025, LIMITS, {}).find(
      (r) => r.kind === 'tfsa' && r.personId === 'p1')!;
    expect(tfsa.usedYtd).toBe(3000);
    expect(tfsa.remaining).toBe(4000);
  });

  it('ignores contributions outside the year', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2024-12-31', accountId: 'a', personId: 'p1', amount: 3000, kind: 'tfsa' },
    ];
    expect(contributionRoomUsed(events, 2025, LIMITS, {})).toHaveLength(0);
  });
});

describe('cesgStatusPerKid', () => {
  it('reports captured + lifetime-remaining grants for a kid', () => {
    const grants: CesgGrant[] = [
      { id: 'g1', date: '2025-02-01', beneficiaryId: 'k1', contributionEventId: 'c1', amount: 200, accountId: 'a' },
    ];
    const out = cesgStatusPerKid(grants, ['k1'], 2025, LIMITS, 6);
    expect(out[0].capturedYtd).toBe(200);
    expect(out[0].lifetimeRemaining).toBe(7000);
  });
});
```

- [ ] **Step 3: Run the full frontend suite**

Run: `npm test`
Expected: all api + store + kpi + canadian tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/__tests__/kpi.test.ts frontend/src/lib/__tests__/canadian.test.ts
git commit -m "test: kpi net-worth recompute + canadian room/CESG"
```

---

### Task 5.5: Run docs (README) + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Running locally" section to `README.md`**

```markdown
## Running locally

DeepPocket is two processes: a FastAPI backend (SQLite) and the Vite frontend.

### Backend (from `backend/`)

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python seed.py                 # seed demo data  (or: python seed.py --investments=empty)
uvicorn app.main:app --port 8000
```

### Frontend (from `frontend/`)

```bash
npm install
npm run dev                    # http://localhost:5173 (proxies /api -> :8000)
```

### Tests

```bash
# backend (from backend/, venv active)
pytest -q
# frontend (from frontend/)
npm test
```

### Regenerating mock data

```bash
python mock/generate.py        # writes mock/out/ + frontend/src/data/fixtures.json
```
```

- [ ] **Step 2: Full backend suite**

Run (from `backend/`, venv active): `pytest -q`
Expected: all tests pass (cesg, fixtures payload, seed, people/accounts, snapshots, csv_import, contributions, data endpoint).

- [ ] **Step 3: Full frontend checks**

Run (from `frontend/`): `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all Vitest tests pass, production build succeeds.

- [ ] **Step 4: End-to-end smoke**

Backend: `python seed.py --investments=empty && uvicorn app.main:app --port 8000`.
Frontend: `npm run dev`. Then:
1. Settings → add yourself + spouse + kids; add a few investment accounts.
2. Import → upload the sample CSV; confirm summary and that Net Worth updates.
3. Investments → add/fix a snapshot value as of a date; add an RESP contribution; confirm the CESG dashboard shows 20% captured.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: local run + test instructions for the M2 stack"
```

---

## Done-when (milestone acceptance)

- All 10 M1 screens render from the backend (Phase 1 exit).
- CSV import creates people/accounts and upserts snapshots with a row-level summary (#2).
- Snapshots are addable/editable/deletable; "update value as of a date" upserts (#3).
- People & investment accounts are managed from Settings; guarded deletes (#4).
- RRSP/TFSA/RESP/FHSA contributions persist; RESP drives CESG automatically; room + CESG cards show real numbers (#5).
- `pytest -q` and `npm test` are green; README documents how to run everything (#7, partial).

---

## Self-review (completed during planning)

- **Spec coverage:** Goals §2.1 (FastAPI+SQLite) → Phase 1; §2.2 (seam swap) → Tasks 1.7/2.4; §2.3 (CSV import) → Tasks 3.2/3.3/3.6; §2.4 (editable snapshots) → Tasks 3.1/3.5; §2.5 (people/accounts) → Phase 2; §2.6 (contributions + CESG) → Phase 4; §2.7 (tests) → backend Phases 1–4 + Phase 5. API table §6 → routers in Phases 1–4. Data model §5 → Task 1.1 + `constants.normalize_kind`. Seeding §"strategy" → Task 1.5 (`--investments=empty`). Open questions §11 resolved: delete = block-with-message (Tasks 2.2/2.3); seed default = demo (Task 1.5); `reclassifyTransaction` untouched (left as M1 in-memory action).
- **Type consistency:** payload keys match `Fixtures` (Task 1.4 test asserts key-set parity); served `kind` constrained to `AccountKind` via `KIND_MAP`/`normalize_kind`; served `investments` are id-less (matches `InvestmentSnapshot`); `CesgGrant` shape matches `cesgStatusPerKid` consumption; store method names (`addPerson`/`addAccount`/`saveSnapshot`/`addContribution`/`refetch`) are used identically in the Settings/Investments/Import tasks.
- **Placeholder scan:** none — every code step contains full code; every run step lists the expected result.
