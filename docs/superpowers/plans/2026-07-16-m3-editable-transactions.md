# M3 — Editable Banking & Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the banking domain (transactions, bank accounts, categories, budget) into SQLite, make transactions editable (category/flags/notes/tags), import bank & credit-card CSVs with dedup, and auto-categorize via history + user-editable rules.

**Architecture:** Full cutover (spec approach A): `seed.py` ingests all of `mock/out/fixtures.json`; `build_payload` composes `GET /api/data` 100% from the DB with an unchanged wire shape, so no screen or `lib/` function changes for the cutover itself. New endpoints: `PATCH /api/transactions/{id}`, rules CRUD, `POST /api/import/transactions-csv`. All frontend writes go through the `api.ts` seam + store mutate-then-refetch.

**Tech Stack:** FastAPI + SQLModel + SQLite (uv), pytest; React 18 + TypeScript strict + Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-m3-editable-transactions-design.md`

## Global Constraints

- Amount sign convention everywhere: **expense < 0, inflow > 0**.
- Dates are ISO `YYYY-MM-DD` strings in the DB and on the wire.
- Transaction editable fields are ONLY: `category_id`, `is_transfer`, `is_duplicate`, `notes`, `tags`. PATCH rejects anything else with 422 (`extra="forbid"`).
- `/api/data` keeps the exact M2 key set; `rules` is NOT in the payload.
- Fixture IDs are preserved verbatim at seed (`sanjay_chequing`, `t1`, `groceries`, …).
- Categorization precedence: history → rules (newest first) → `unclassified`.
- Frontend: business logic in `lib/` or the backend, never in components; all data access through `frontend/src/data/api.ts`; types in `frontend/src/types/index.ts`.
- Backend commands run from `backend/` with `uv run …`; frontend from `frontend/`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (write the message to a scratch file and use `git commit -F` if quoting fights PowerShell).
- After any schema change, `uv run seed.py` must be re-run against a deleted `deeppocket.db` before manual/live testing (pytest uses in-memory DBs and doesn't care).

---

### Task 1: Schema + constants (models, `opening_balance`, CRA limits, MM/DD/YYYY dates)

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/constants.py`
- Test: `backend/tests/test_constants.py` (new), existing suite must stay green

**Interfaces:**
- Produces: SQLModel tables `Category`, `Transaction`, `Rule`, `BudgetLine`, `BudgetConfig`, `AppMeta`; `Account.opening_balance: float`; `CRA_LIMITS_2025: dict`; `normalize_date` accepting `MM/DD/YYYY`.

- [ ] **Step 1: Write the failing test for `normalize_date`**

Create `backend/tests/test_constants.py`:

```python
import pytest

from app.constants import normalize_date, CRA_LIMITS_2025


def test_normalize_date_accepts_us_slash_format():
    assert normalize_date("03/31/2026") == "2026-03-31"


def test_normalize_date_existing_formats_still_work():
    assert normalize_date("20260331") == "2026-03-31"
    assert normalize_date("2026-03-31") == "2026-03-31"


def test_normalize_date_rejects_garbage():
    with pytest.raises(ValueError):
        normalize_date("31-03-2026")


def test_cra_limits_match_m2_values():
    assert CRA_LIMITS_2025["TFSA_ANNUAL"] == 7000
    assert CRA_LIMITS_2025["CESG_LIFETIME_PER_CHILD"] == 7200
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `uv run pytest tests/test_constants.py -v`
Expected: FAIL — `ImportError: cannot import name 'CRA_LIMITS_2025'`.

- [ ] **Step 3: Extend `backend/app/constants.py`**

Add after `CONTRIBUTION_KINDS`:

```python
# CRA limits are law, not user data — served into /api/data's craLimits block.
# Values match lib/canadian.ts CRA_LIMITS_2025 on the frontend.
CRA_LIMITS_2025 = {
    "TFSA_ANNUAL": 7000,
    "RRSP_ANNUAL_PCT": 0.18,
    "RRSP_ANNUAL_CAP": 32490,
    "RESP_LIFETIME_PER_CHILD": 50000,
    "RESP_ANNUAL_FOR_FULL_CESG": 2500,
    "FHSA_ANNUAL": 8000,
    "FHSA_LIFETIME": 40000,
    "CESG_RATE": 0.2,
    "CESG_ANNUAL_PER_CHILD": 500,
    "CESG_LIFETIME_PER_CHILD": 7200,
}
```

Extend `normalize_date` (docstring mentions all three formats):

```python
def normalize_date(s: str) -> str:
    """Accept 'YYYYMMDD', 'YYYY-MM-DD', or 'MM/DD/YYYY' (bank exports); return ISO."""
    s = s.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        return f"{s[6:10]}-{s[0:2]}-{s[3:5]}"
    raise ValueError(f"Unrecognized date format: {s!r} (expected YYYYMMDD, YYYY-MM-DD, or MM/DD/YYYY)")
```

- [ ] **Step 4: Add the new tables to `backend/app/models.py`**

Add `opening_balance` to `Account` (after `is_liability`):

```python
    is_liability: bool = False
    # Bank-account starting balance (from the M1 meta.openingBalances block); feeds the
    # payload's meta.openingBalances, which lib/kpi.ts cash math depends on.
    opening_balance: float = 0.0
```

Append at the end of the file:

```python
class Category(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    group: str                          # CategoryGroup value, e.g. 'essentials'
    bucket503020: Optional[str] = None  # 'needs' | 'wants' | 'savings'
    is_essential: bool = False


class Transaction(SQLModel, table=True):
    # Bank facts (date/amount/merchant/account) are immutable by design; only
    # category_id, is_transfer, is_duplicate, notes, tags are user-editable.
    # No uniqueness on (account, date, merchant, amount): two identical purchases in a
    # day are legitimate — dedup is an import-time check, not a DB rule.
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    date: str = Field(index=True)       # ISO 'YYYY-MM-DD'
    raw_merchant: str
    merchant: str
    amount: float                       # expense < 0, inflow > 0
    category_id: str = Field(foreign_key="category.id", index=True)
    person_id: Optional[str] = Field(default=None, foreign_key="person.id")
    is_transfer: bool = False
    is_duplicate: bool = False
    notes: Optional[str] = None
    tags: Optional[str] = None          # JSON-encoded list[str]
    running_total: Optional[float] = None


class Rule(SQLModel, table=True):
    # Categorization rule: keyword matched case-insensitively as a substring against a
    # transaction's raw_merchant + merchant. Newest rule wins (order by created_at desc).
    id: str = Field(primary_key=True)
    keyword: str
    category_id: str = Field(foreign_key="category.id")
    created_at: str                     # ISO timestamp


class BudgetLine(SQLModel, table=True):
    category_id: str = Field(foreign_key="category.id", primary_key=True)
    monthly_cap: float
    rollover: bool = False


class BudgetConfig(SQLModel, table=True):
    # Single row (id=1): budget mode + optional savings-rate target.
    id: int = Field(default=1, primary_key=True)
    mode: str                           # 'envelope' | 'zero_based' | 'fifty_thirty_twenty'
    target_savings_rate: Optional[float] = None


class AppMeta(SQLModel, table=True):
    # Key-value bag for the payload's meta block (generatedAt / seed / monthsCovered).
    key: str = Field(primary_key=True)
    value: str
```

- [ ] **Step 5: Run the full backend suite**

Run: `uv run pytest -q`
Expected: all tests pass (59 pre-existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/constants.py backend/tests/test_constants.py
git commit -m "feat(m3): banking-domain tables, opening_balance, CRA limits constant, MM/DD/YYYY dates"
```

---

### Task 2: Seed the banking domain

**Files:**
- Modify: `backend/seed.py`
- Test: `backend/tests/test_seed_banking.py` (new)

**Interfaces:**
- Consumes: Task 1 models.
- Produces: `seed(session, investments=...)` also populating `Category`, `Transaction`, `BudgetLine`, `BudgetConfig`, `AppMeta`, bank `Account` rows (with `opening_balance`, `custom_name` = fixture display name, owners in `AccountOwner`). Idempotent. `--investments=empty` no longer touches bank accounts.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_seed_banking.py`:

```python
import json

from sqlmodel import select

from app.config import FIXTURES_PATH
from app.constants import BANK_KINDS
from app.models import Account, AccountOwner, AppMeta, BudgetConfig, BudgetLine, Category, Transaction
from seed import seed


def _base():
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def test_seed_populates_banking_domain(session):
    seed(session)
    base = _base()
    assert len(session.exec(select(Category)).all()) == len(base["categories"])
    assert len(session.exec(select(Transaction)).all()) == len(base["transactions"])
    assert len(session.exec(select(BudgetLine)).all()) == len(base["budget"]["lines"])
    assert session.get(BudgetConfig, 1).mode == base["budget"]["mode"]
    assert session.get(AppMeta, "generatedAt").value == base["meta"]["generatedAt"]


def test_seed_bank_accounts_keep_ids_names_and_opening_balances(session):
    seed(session)
    acc = session.get(Account, "sanjay_chequing")
    assert acc is not None and acc.kind == "chequing"
    assert acc.opening_balance == 14500.0
    # custom_name preserves the fixture display name so screens render identically.
    assert acc.custom_name == "TD Chequing (Sanjay)"
    owners = session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "sanjay_chequing")
    ).all()
    assert [o.person_id for o in owners] == ["sanjay"]
    visa = session.get(Account, "sanjay_td_visa")
    assert visa.is_liability is True


def test_seed_is_idempotent(session):
    seed(session)
    seed(session)
    base = _base()
    assert len(session.exec(select(Transaction)).all()) == len(base["transactions"])
    assert len(session.exec(select(Category)).all()) == len(base["categories"])
    bank = [a for a in session.exec(select(Account)).all() if a.kind in BANK_KINDS]
    assert len(bank) == sum(1 for a in _base()["accounts"] if a["kind"] in BANK_KINDS)


def test_investments_empty_keeps_banking(session):
    seed(session)
    seed(session, investments="empty")
    assert session.get(Account, "sanjay_chequing") is not None
    assert len(session.exec(select(Transaction)).all()) > 0
    inv = [a for a in session.exec(select(Account)).all() if a.kind not in BANK_KINDS]
    assert inv == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_seed_banking.py -v`
Expected: FAIL — categories/transactions counts are 0 (nothing seeds them yet).

- [ ] **Step 3: Extend `backend/seed.py`**

Update imports:

```python
from app.constants import BANK_KINDS, INVESTMENT_KINDS, new_id
from app.models import (
    Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution,
    Category, Transaction, Rule, BudgetLine, BudgetConfig, AppMeta,
)
```

In `seed()`, replace the `if investments == "empty":` block so it only clears the investment domain (bank accounts now live in the same table):

```python
    if investments == "empty":
        # Drop only the investment domain; banking data (accounts in BANK_KINDS and
        # their transactions) is not part of the 'empty investments' story.
        for model in (Contribution, InvestmentSnapshot):
            for row in session.exec(select(model)).all():
                session.delete(row)
        inv_ids = {a.id for a in session.exec(select(Account)).all() if a.kind in INVESTMENT_KINDS}
        for model in (AccountOwner, AccountBeneficiary):
            for row in session.exec(select(model)).all():
                if row.account_id in inv_ids:
                    session.delete(row)
        for aid in inv_ids:
            session.delete(session.get(Account, aid))
        session.commit()
        _seed_banking(session, base)
        return
```

Change the existing account loop's skip line from `if a["kind"] not in INVESTMENT_KINDS: continue` — keep it (investment accounts only there), and add a call at the end of `seed()` (after the contributions block): `_seed_banking(session, base)`.

Add the new function:

```python
def _seed_banking(session: Session, base: dict) -> None:
    """Seed categories, bank accounts, transactions, budget, and app meta. Idempotent:
    every row is upserted by its fixture id / natural pk."""
    for c in base["categories"]:
        _upsert(session, Category, c["id"], {
            "name": c["name"], "group": c["group"],
            "bucket503020": c.get("bucket503020"),
            "is_essential": c.get("isEssential", False),
        })
    session.commit()

    opening = base["meta"].get("openingBalances", {})
    for a in base["accounts"]:
        if a["kind"] not in BANK_KINDS:
            continue
        _upsert(session, Account, a["id"], {
            "institution": a["institution"],
            "account_type": a["kind"],
            "kind": a["kind"],
            # Preserve the fixture display name exactly (screens keep rendering
            # "TD Chequing (Sanjay)", not the computed owners+institution+type form).
            "custom_name": a["name"],
            "is_liability": a.get("isLiability", False),
            "opening_balance": opening.get(a["id"], 0.0),
        })
        for row in session.exec(
            select(AccountOwner).where(AccountOwner.account_id == a["id"])
        ).all():
            session.delete(row)
        for owner in a["ownerIds"]:
            session.add(AccountOwner(account_id=a["id"], person_id=owner))
    session.commit()

    for t in base["transactions"]:
        _upsert(session, Transaction, t["id"], {
            "account_id": t["accountId"], "date": t["date"],
            "raw_merchant": t["rawMerchant"], "merchant": t["merchant"],
            "amount": t["amount"], "category_id": t["categoryId"],
            "person_id": t.get("personId"),
            "is_transfer": t.get("isTransfer", False),
            "is_duplicate": t.get("isDuplicate", False),
            "notes": t.get("notes"),
            "tags": json.dumps(t["tags"]) if t.get("tags") else None,
            "running_total": t.get("runningTotal"),
        })
    session.commit()

    for line in base["budget"]["lines"]:
        existing = session.get(BudgetLine, line["categoryId"])
        if existing:
            existing.monthly_cap = line["monthlyCap"]
            existing.rollover = line["rollover"]
            session.add(existing)
        else:
            session.add(BudgetLine(
                category_id=line["categoryId"],
                monthly_cap=line["monthlyCap"], rollover=line["rollover"],
            ))
    cfg = session.get(BudgetConfig, 1) or BudgetConfig(id=1, mode=base["budget"]["mode"])
    cfg.mode = base["budget"]["mode"]
    cfg.target_savings_rate = base["budget"].get("targetSavingsRate")
    session.add(cfg)

    for key in ("generatedAt", "seed", "monthsCovered"):
        meta_row = session.get(AppMeta, key) or AppMeta(key=key, value="")
        meta_row.value = str(base["meta"][key])
        session.add(meta_row)
    session.commit()
```

Note: `_upsert` passes `id=pk` as a kwarg, but `BudgetLine`/`AppMeta`/`BudgetConfig` have different pk names — that's why they're upserted by hand above. `Rule` is deliberately NOT seeded (starts empty; history matching covers seeded merchants).

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_seed_banking.py -v` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/seed.py backend/tests/test_seed_banking.py
git commit -m "feat(m3): seed ingests banking domain (accounts, transactions, categories, budget, meta)"
```

---

### Task 3: `/api/data` composed 100% from the DB

**Files:**
- Modify: `backend/app/services/fixtures.py`
- Modify: `backend/tests/test_fixtures_payload.py` (existing payload tests)

**Interfaces:**
- Consumes: Task 2 seeded tables.
- Produces: `build_payload(session) -> dict` with the same key set as M2 but zero file reads; `_transaction_out(t: Transaction) -> dict` (Task 5 reuses it).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_fixtures_payload.py`:

```python
import app.services.fixtures as fixtures_service
from app.services.fixtures import build_payload
from seed import seed


EXPECTED_KEYS = {
    "household", "accounts", "categories", "transactions", "investments",
    "contributionEvents", "cesgGrants", "budget", "craLimits", "meta",
}


def test_payload_is_composed_entirely_from_db(session, monkeypatch):
    seed(session)
    # The fixtures file must not be touched at request time.
    monkeypatch.setattr(
        fixtures_service, "_load_base",
        lambda: (_ for _ in ()).throw(AssertionError("fixtures file read at request time")),
        raising=False,
    )
    payload = build_payload(session)
    assert set(payload.keys()) == EXPECTED_KEYS
    assert len(payload["transactions"]) == 864
    assert payload["craLimits"]["TFSA_ANNUAL"] == 7000
    assert payload["meta"]["openingBalances"]["sanjay_chequing"] == 14500.0
    assert payload["meta"]["seed"] == 42
    assert payload["budget"]["mode"] == "envelope"
    tx = next(t for t in payload["transactions"] if t["id"] == "t1")
    assert tx == {
        "id": "t1", "date": "2025-05-15", "accountId": "sanjay_chequing",
        "rawMerchant": "PAYROLL DEP NUTRIEN", "merchant": "Payroll Dep Nutrien",
        "amount": 4666.73, "categoryId": "salary", "personId": "sanjay",
        "runningTotal": 16015.09,
    }


def test_payload_accounts_include_bank_and_investment(session):
    seed(session)
    payload = build_payload(session)
    kinds = {a["kind"] for a in payload["accounts"]}
    assert "chequing" in kinds and "credit_card" in kinds
    chequing = next(a for a in payload["accounts"] if a["id"] == "sanjay_chequing")
    assert chequing["name"] == "TD Chequing (Sanjay)"
    visa = next(a for a in payload["accounts"] if a["id"] == "sanjay_td_visa")
    assert visa["isLiability"] is True
```

(If the existing tests in this file assert on the old fixture-merged accounts list, update those assertions to seed first — pattern: call `seed(session)` then assert against the DB-composed payload.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_fixtures_payload.py -v`
Expected: new tests FAIL (payload still reads `base["transactions"]` from the file; `meta.seed` is the raw fixture int, etc.).

- [ ] **Step 3: Rewrite `backend/app/services/fixtures.py`**

Replace the imports and `build_payload`; keep `_person_out`, `_account_out`, `_contribution_out` unchanged. Delete `_load_base` and the `FIXTURES_PATH` / `BANK_KINDS` imports.

```python
import json
from sqlmodel import Session, select

from ..constants import BANK_KINDS, CRA_LIMITS_2025
from ..models import (
    Person, Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution,
    Category, Transaction, BudgetLine, BudgetConfig, AppMeta,
)
from .cesg import derive_cesg_grants
```

Add serializers after `_contribution_out`:

```python
def _category_out(c: Category) -> dict:
    out = {"id": c.id, "name": c.name, "group": c.group}
    if c.bucket503020:
        out["bucket503020"] = c.bucket503020
    if c.is_essential:
        out["isEssential"] = True
    return out


def _transaction_out(t: Transaction) -> dict:
    out = {
        "id": t.id, "date": t.date, "accountId": t.account_id,
        "rawMerchant": t.raw_merchant, "merchant": t.merchant,
        "amount": t.amount, "categoryId": t.category_id,
    }
    if t.person_id:
        out["personId"] = t.person_id
    if t.is_transfer:
        out["isTransfer"] = True
    if t.is_duplicate:
        out["isDuplicate"] = True
    if t.notes:
        out["notes"] = t.notes
    if t.tags:
        out["tags"] = json.loads(t.tags)
    if t.running_total is not None:
        out["runningTotal"] = t.running_total
    return out
```

New `build_payload` (people/accounts/snapshots/contributions/CESG parts are the same as today — only the fixture-file parts change):

```python
def build_payload(session: Session) -> dict:
    people = session.exec(select(Person)).all()
    accounts = session.exec(select(Account)).all()
    snapshots = session.exec(select(InvestmentSnapshot)).all()
    contributions = session.exec(select(Contribution)).all()
    categories = session.exec(select(Category)).all()
    transactions = session.exec(select(Transaction)).all()
    budget_lines = session.exec(select(BudgetLine)).all()
    budget_cfg = session.get(BudgetConfig, 1)
    meta_rows = {m.key: m.value for m in session.exec(select(AppMeta)).all()}

    owners_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountOwner)).all():
        owners_by_account.setdefault(row.account_id, []).append(row.person_id)
    beneficiaries_by_account: dict[str, list[str]] = {}
    for row in session.exec(select(AccountBeneficiary)).all():
        beneficiaries_by_account.setdefault(row.account_id, []).append(row.person_id)

    names_by_id = {p.id: p.name for p in people}
    accounts_out = []
    for a in accounts:
        owner_ids = sorted(owners_by_account.get(a.id, []))
        accounts_out.append(
            _account_out(
                a,
                owner_ids,
                sorted(beneficiaries_by_account.get(a.id, [])),
                sorted(names_by_id.get(pid, pid) for pid in owner_ids),
            )
        )

    grants = derive_cesg_grants(contributions, CRA_LIMITS_2025)

    budget = {
        "mode": budget_cfg.mode if budget_cfg else "envelope",
        "lines": [
            {"categoryId": line.category_id, "monthlyCap": line.monthly_cap, "rollover": line.rollover}
            for line in budget_lines
        ],
    }
    if budget_cfg and budget_cfg.target_savings_rate is not None:
        budget["targetSavingsRate"] = budget_cfg.target_savings_rate

    return {
        "household": [_person_out(p) for p in people],
        "accounts": accounts_out,
        "categories": [_category_out(c) for c in categories],
        "transactions": [
            _transaction_out(t) for t in sorted(transactions, key=lambda t: (t.date, t.id))
        ],
        "investments": [
            {"date": s.date, "accountId": s.account_id, "amount": s.amount}
            for s in snapshots
        ],
        "contributionEvents": [_contribution_out(c) for c in contributions],
        "cesgGrants": grants,
        "budget": budget,
        "craLimits": CRA_LIMITS_2025,
        "meta": {
            "generatedAt": meta_rows.get("generatedAt", ""),
            "seed": int(meta_rows.get("seed", "0")),
            "monthsCovered": int(meta_rows.get("monthsCovered", "0")),
            "openingBalances": {
                a.id: a.opening_balance for a in accounts if a.kind in BANK_KINDS
            },
        },
    }
```

Check `derive_cesg_grants`'s signature — in M2 it takes `base["craLimits"]`; `CRA_LIMITS_2025` is the same dict shape, so it drops in.

- [ ] **Step 4: Run the whole backend suite; fix fallout**

Run: `uv run pytest -q`
Expected: the new tests pass. Any pre-existing payload/route tests that relied on the file-merged accounts will fail until they seed first — update them to call `seed(session)` (or build the rows they need) rather than weakening assertions.

- [ ] **Step 5: Reseed the dev DB and eyeball the API**

```bash
rm deeppocket.db  # from backend/  (PowerShell: Remove-Item deeppocket.db)
uv run seed.py
```

Then `uv run uvicorn app.main:app --port 8000` in the background, `curl http://localhost:8000/api/data` to a temp file, confirm keys and 864 transactions, stop the server.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/fixtures.py backend/tests/test_fixtures_payload.py
git commit -m "feat(m3): /api/data composed entirely from the DB — fixtures file is seed input only"
```

---

### Task 4: Purge modes cover the banking domain

**Files:**
- Modify: `backend/app/routers/admin.py`
- Test: `backend/tests/test_admin_purge.py` (extend if it exists, else create)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `purge mode=investments` deletes ONLY investment-kind accounts (+ snapshots/contributions/join rows); `mode=all` additionally wipes `Transaction`, `Rule`, `BudgetLine`, `BudgetConfig`, `Category`, `AppMeta`, bank accounts, people; `mode=demo` wipes all then reseeds everything.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_admin_purge.py` (create the file with this content if absent; if it exists, add these tests — the seeding fixture pattern is `client` + a seeded session via the same engine):

```python
from sqlmodel import Session, select

from app.models import Account, Category, Transaction
from seed import seed


def _seed(engine):
    with Session(engine) as s:
        seed(s)


def test_purge_investments_keeps_banking(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "investments"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert s.get(Account, "sanjay_chequing") is not None
        assert len(s.exec(select(Transaction)).all()) == 864
        kinds = {a.kind for a in s.exec(select(Account)).all()}
        assert kinds <= {"chequing", "savings", "credit_card"}


def test_purge_all_wipes_banking_too(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "all"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert s.exec(select(Transaction)).all() == []
        assert s.exec(select(Category)).all() == []
        assert s.exec(select(Account)).all() == []


def test_purge_demo_restores_everything(client, engine):
    _seed(engine)
    r = client.post("/api/admin/purge", json={"mode": "demo"})
    assert r.status_code == 200
    with Session(engine) as s:
        assert len(s.exec(select(Transaction)).all()) == 864
        assert s.get(Account, "sanjay_chequing") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_admin_purge.py -v`
Expected: `test_purge_investments_keeps_banking` FAILS (current `_purge_investments` deletes ALL accounts, including bank ones).

- [ ] **Step 3: Rework `backend/app/routers/admin.py`**

```python
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..constants import INVESTMENT_KINDS
from ..db import get_session
from ..models import (
    Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution, Person,
    Category, Transaction, Rule, BudgetLine, BudgetConfig, AppMeta,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class PurgeRequest(BaseModel):
    mode: Literal["investments", "all", "demo"]


def _delete_all(session: Session, model) -> None:
    for row in session.exec(select(model)).all():
        session.delete(row)


def _purge_investments(session: Session) -> None:
    # Bank accounts now share the account table — delete only investment-kind accounts
    # and their dependents (child -> parent order).
    _delete_all(session, Contribution)
    _delete_all(session, InvestmentSnapshot)
    inv_ids = {a.id for a in session.exec(select(Account)).all() if a.kind in INVESTMENT_KINDS}
    for model in (AccountBeneficiary, AccountOwner):
        for row in session.exec(select(model)).all():
            if row.account_id in inv_ids:
                session.delete(row)
    for aid in inv_ids:
        session.delete(session.get(Account, aid))


def _purge_banking(session: Session) -> None:
    # Child -> parent: transactions and budget lines reference categories/accounts.
    for model in (Transaction, Rule, BudgetLine, BudgetConfig, AppMeta):
        _delete_all(session, model)
    for model in (AccountBeneficiary, AccountOwner, Account):
        _delete_all(session, model)
    _delete_all(session, Category)


@router.post("/purge")
def purge(body: PurgeRequest, session: Session = Depends(get_session)) -> dict:
    mode = body.mode
    _purge_investments(session)
    if mode in ("all", "demo"):
        _purge_banking(session)
        _delete_all(session, Person)
    session.commit()

    if mode == "demo":
        # Reseed the full demo dataset. Importable because uvicorn/pytest run from backend/.
        from seed import seed
        seed(session, investments="demo")

    return {"mode": mode, "ok": True}
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_admin_purge.py -v` then `uv run pytest -q`
Expected: all pass (existing purge tests may assert investment purge deletes every account — update them: it now spares bank kinds).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/admin.py backend/tests/test_admin_purge.py
git commit -m "feat(m3): purge modes scope to banking domain; investments purge spares bank accounts"
```

---

### Task 5: `PATCH /api/transactions/{id}`

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/transactions.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_transactions_patch.py` (new)

**Interfaces:**
- Consumes: `Transaction` model (Task 1), `_transaction_out` (Task 3).
- Produces: `PATCH /api/transactions/{id}` accepting `{categoryId?, isTransfer?, isDuplicate?, notes?, tags?}` → serialized transaction. 404 unknown id; 422 unknown category or extra field. Clearing semantics: `notes: ""` clears notes, `tags: []` clears tags.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_transactions_patch.py`:

```python
from sqlmodel import Session

from app.models import Account, Category, Transaction


def _make_tx(engine):
    with Session(engine) as s:
        s.add(Category(id="groceries", name="Groceries", group="essentials"))
        s.add(Category(id="dining", name="Dining", group="lifestyle"))
        s.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
        s.add(Transaction(
            id="tx1", account_id="chq", date="2026-01-05",
            raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
            amount=-73.92, category_id="groceries",
        ))
        s.commit()


def test_patch_reclassifies(client, engine):
    _make_tx(engine)
    r = client.patch("/api/transactions/tx1", json={"categoryId": "dining"})
    assert r.status_code == 200
    assert r.json()["categoryId"] == "dining"


def test_patch_flags_notes_tags(client, engine):
    _make_tx(engine)
    r = client.patch("/api/transactions/tx1", json={
        "isTransfer": True, "isDuplicate": True,
        "notes": "team lunch", "tags": ["work", "reimbursable"],
    })
    body = r.json()
    assert body["isTransfer"] is True and body["isDuplicate"] is True
    assert body["notes"] == "team lunch" and body["tags"] == ["work", "reimbursable"]
    # Clearing: empty string / empty list remove the values from the payload.
    r2 = client.patch("/api/transactions/tx1", json={"notes": "", "tags": []})
    assert "notes" not in r2.json() and "tags" not in r2.json()


def test_patch_unknown_transaction_404(client, engine):
    _make_tx(engine)
    assert client.patch("/api/transactions/nope", json={"notes": "x"}).status_code == 404


def test_patch_unknown_category_422(client, engine):
    _make_tx(engine)
    assert client.patch("/api/transactions/tx1", json={"categoryId": "nope"}).status_code == 422


def test_patch_rejects_bank_facts_422(client, engine):
    _make_tx(engine)
    for bad in ({"amount": 5}, {"date": "2026-01-06"}, {"merchant": "X"}, {"accountId": "other"}):
        assert client.patch("/api/transactions/tx1", json=bad).status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_transactions_patch.py -v`
Expected: FAIL — 404 (route doesn't exist; TestClient raises or returns 404/405 for every case, so the 200-assertions fail).

- [ ] **Step 3: Add the schema and router**

Append to `backend/app/schemas.py`:

```python
from pydantic import ConfigDict


class TransactionPatch(BaseModel):
    # Bank facts (date/amount/merchant/account) are immutable: extra="forbid" turns any
    # attempt to write them into a 422 instead of a silent ignore.
    model_config = ConfigDict(extra="forbid")

    categoryId: Optional[str] = None
    isTransfer: Optional[bool] = None
    isDuplicate: Optional[bool] = None
    notes: Optional[str] = None      # "" clears
    tags: Optional[list[str]] = None  # [] clears
```

Create `backend/app/routers/transactions.py`:

```python
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Category, Transaction
from ..schemas import TransactionPatch
from ..services.fixtures import _transaction_out

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.patch("/{tx_id}")
def patch_transaction(
    tx_id: str, body: TransactionPatch, session: Session = Depends(get_session)
) -> dict:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if body.categoryId is not None:
        if not session.get(Category, body.categoryId):
            raise HTTPException(status_code=422, detail=f"Unknown category: {body.categoryId}")
        tx.category_id = body.categoryId
    if body.isTransfer is not None:
        tx.is_transfer = body.isTransfer
    if body.isDuplicate is not None:
        tx.is_duplicate = body.isDuplicate
    if body.notes is not None:
        tx.notes = body.notes or None
    if body.tags is not None:
        tx.tags = json.dumps(body.tags) if body.tags else None

    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)
```

In `backend/app/main.py`, extend the router import/include lines:

```python
from .routers import data, people, accounts, snapshots, imports, contributions, admin, transactions
...
app.include_router(transactions.router)
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_transactions_patch.py -v` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/transactions.py backend/app/main.py backend/tests/test_transactions_patch.py
git commit -m "feat(m3): PATCH /api/transactions/{id} — category, flags, notes, tags; bank facts immutable"
```

---

### Task 6: Rules CRUD endpoints

**Files:**
- Modify: `backend/app/schemas.py`
- Create: `backend/app/routers/rules.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_rules.py` (new)

**Interfaces:**
- Consumes: `Rule`, `Category` models.
- Produces: `GET/POST /api/rules`, `PUT/DELETE /api/rules/{id}`. Wire shape: `{id, keyword, categoryId, createdAt}`. 422 empty keyword / unknown category; 409 duplicate keyword (case-insensitive); 404 unknown id. Task 8's UI and Task 7's categorizer rely on `created_at` ISO ordering.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_rules.py`:

```python
from sqlmodel import Session

from app.models import Category


def _seed_categories(engine):
    with Session(engine) as s:
        s.add(Category(id="groceries", name="Groceries", group="essentials"))
        s.add(Category(id="dining", name="Dining", group="lifestyle"))
        s.commit()


def test_rules_crud_roundtrip(client, engine):
    _seed_categories(engine)
    r = client.post("/api/rules", json={"keyword": "costco", "categoryId": "groceries"})
    assert r.status_code == 200
    rule = r.json()
    assert rule["keyword"] == "costco" and rule["categoryId"] == "groceries"
    assert rule["createdAt"]

    assert client.get("/api/rules").json() == [rule]

    r2 = client.put(f"/api/rules/{rule['id']}", json={"categoryId": "dining"})
    assert r2.status_code == 200 and r2.json()["categoryId"] == "dining"

    assert client.delete(f"/api/rules/{rule['id']}").status_code == 204
    assert client.get("/api/rules").json() == []


def test_rule_validation(client, engine):
    _seed_categories(engine)
    assert client.post("/api/rules", json={"keyword": "  ", "categoryId": "groceries"}).status_code == 422
    assert client.post("/api/rules", json={"keyword": "x", "categoryId": "nope"}).status_code == 422
    client.post("/api/rules", json={"keyword": "Costco", "categoryId": "groceries"})
    assert client.post("/api/rules", json={"keyword": "COSTCO", "categoryId": "dining"}).status_code == 409
    assert client.put("/api/rules/nope", json={"keyword": "y"}).status_code == 404
    assert client.delete("/api/rules/nope").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_rules.py -v`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Add schemas and the router**

Append to `backend/app/schemas.py`:

```python
class RuleCreate(BaseModel):
    keyword: str
    categoryId: str


class RuleUpdate(BaseModel):
    keyword: Optional[str] = None
    categoryId: Optional[str] = None
```

Create `backend/app/routers/rules.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..constants import new_id
from ..db import get_session
from ..models import Category, Rule
from ..schemas import RuleCreate, RuleUpdate

router = APIRouter(prefix="/api/rules", tags=["rules"])


def _rule_out(r: Rule) -> dict:
    return {"id": r.id, "keyword": r.keyword, "categoryId": r.category_id, "createdAt": r.created_at}


def _validate(session: Session, keyword: str | None, category_id: str | None, exclude_id: str | None = None) -> None:
    if keyword is not None:
        if not keyword.strip():
            raise HTTPException(status_code=422, detail="Keyword must not be empty")
        clash = next(
            (r for r in session.exec(select(Rule)).all()
             if r.keyword.lower() == keyword.strip().lower() and r.id != exclude_id),
            None,
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"A rule for {keyword!r} already exists")
    if category_id is not None and not session.get(Category, category_id):
        raise HTTPException(status_code=422, detail=f"Unknown category: {category_id}")


@router.get("")
def list_rules(session: Session = Depends(get_session)) -> list[dict]:
    rules = session.exec(select(Rule)).all()
    return [_rule_out(r) for r in sorted(rules, key=lambda r: r.created_at, reverse=True)]


@router.post("")
def create_rule(body: RuleCreate, session: Session = Depends(get_session)) -> dict:
    _validate(session, body.keyword, body.categoryId)
    rule = Rule(
        id=new_id("rule"), keyword=body.keyword.strip(), category_id=body.categoryId,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _rule_out(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: str, body: RuleUpdate, session: Session = Depends(get_session)) -> dict:
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    _validate(session, body.keyword, body.categoryId, exclude_id=rule_id)
    if body.keyword is not None:
        rule.keyword = body.keyword.strip()
    if body.categoryId is not None:
        rule.category_id = body.categoryId
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: str, session: Session = Depends(get_session)) -> None:
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    session.delete(rule)
    session.commit()
```

In `backend/app/main.py`, add `rules` to the router import and `app.include_router(rules.router)`.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_rules.py -v` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/rules.py backend/app/main.py backend/tests/test_rules.py
git commit -m "feat(m3): rules CRUD endpoints (keyword -> category, newest-first precedence)"
```

---

### Task 7: Categorization service (history → rules → unclassified)

**Files:**
- Create: `backend/app/services/categorize.py`
- Test: `backend/tests/test_categorize.py` (new)

**Interfaces:**
- Consumes: `Transaction`, `Rule` models.
- Produces: `categorize(session, raw_merchant: str, merchant: str) -> tuple[str, str]` returning `(category_id, method)` with `method ∈ {"history", "rules", "unclassified"}`. Task 9's importer consumes this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_categorize.py`:

```python
from sqlmodel import Session

from app.models import Account, Category, Rule, Transaction
from app.services.categorize import categorize


def _setup(session: Session) -> None:
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(Category(id="dining", name="Dining", group="lifestyle"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.commit()


def test_history_beats_rules(session):
    _setup(session)
    session.add(Transaction(
        id="old", account_id="chq", date="2026-01-01",
        raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
        amount=-50, category_id="groceries",
    ))
    session.add(Rule(id="r1", keyword="costco", category_id="dining", created_at="2026-01-02T00:00:00"))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("groceries", "history")


def test_history_uses_most_recent(session):
    _setup(session)
    session.add(Transaction(id="a", account_id="chq", date="2026-01-01",
                            raw_merchant="X", merchant="Tims", amount=-5, category_id="groceries"))
    session.add(Transaction(id="b", account_id="chq", date="2026-02-01",
                            raw_merchant="X", merchant="Tims", amount=-5, category_id="dining"))
    session.commit()
    assert categorize(session, "X", "Tims") == ("dining", "history")


def test_rules_match_substring_case_insensitive_newest_first(session):
    _setup(session)
    session.add(Rule(id="r1", keyword="costco", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.add(Rule(id="r2", keyword="costco whol", category_id="dining", created_at="2026-02-01T00:00:00"))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("dining", "rules")


def test_fallback_unclassified(session):
    _setup(session)
    assert categorize(session, "NEW MERCHANT", "New Merchant") == ("unclassified", "unclassified")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_categorize.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `backend/app/services/categorize.py`**

```python
from sqlmodel import Session, select

from ..models import Rule, Transaction

UNCLASSIFIED = "unclassified"


def categorize(session: Session, raw_merchant: str, merchant: str) -> tuple[str, str]:
    """Pick a category for an incoming transaction: exact merchant history first
    (most recent by date wins), then keyword rules (newest rule first, case-insensitive
    substring against raw + cleaned merchant), else the 'unclassified' category.
    Returns (category_id, method) so import summaries can report the split."""
    hit = session.exec(
        select(Transaction)
        .where(Transaction.merchant == merchant)
        .order_by(Transaction.date.desc())  # type: ignore[attr-defined]
    ).first()
    if hit:
        return hit.category_id, "history"

    hay = f"{raw_merchant} {merchant}".lower()
    rules = session.exec(select(Rule)).all()
    for rule in sorted(rules, key=lambda r: r.created_at, reverse=True):
        if rule.keyword.lower() in hay:
            return rule.category_id, "rules"

    return UNCLASSIFIED, "unclassified"
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_categorize.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/categorize.py backend/tests/test_categorize.py
git commit -m "feat(m3): categorization service — history, then rules newest-first, then unclassified"
```

---

### Task 8: Transaction CSV import (service + endpoint)

**Files:**
- Create: `backend/app/services/transactions_csv.py`
- Modify: `backend/app/routers/imports.py`
- Test: `backend/tests/test_transactions_csv.py` (new)

**Interfaces:**
- Consumes: `categorize` (Task 7), `normalize_date` (Task 1), `Transaction`/`Account`/`Category` models.
- Produces: `import_transactions_csv(text: str, session: Session) -> dict` returning `{"created", "duplicates", "skipped", "errors": [{"row", "reason"}], "categorized": {"history", "rules", "unclassified"}}`; endpoint `POST /api/import/transactions-csv` (multipart `file`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_transactions_csv.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_transactions_csv.py -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `backend/app/services/transactions_csv.py`**

```python
import csv
import io

from sqlmodel import Session, select

from ..constants import new_id, normalize_date
from ..models import Account, Category, Transaction
from .categorize import categorize

# Two real export shapes, sniffed by header set (issue: spec §6).
BANK_HEADERS = {"date", "transaction_detail", "withdrawal", "deposit", "account"}
CC_HEADERS = {"date", "merchant", "amount", "payment", "account"}


def _clean_merchant(raw: str) -> str:
    # Same cleanup the mock generator applies (mock/generate.py resolve_alias).
    cleaned = raw.split("#")[0].strip().rstrip(",.").title()
    return cleaned or raw


def _parse_amount(row: dict, neg_col: str, pos_col: str) -> float:
    neg, pos = row.get(neg_col, ""), row.get(pos_col, "")
    if bool(neg) == bool(pos):
        raise ValueError(f"exactly one of {neg_col}/{pos_col} must have an amount")
    return -float(neg) if neg else float(pos)


def import_transactions_csv(text: str, session: Session) -> dict:
    summary = {
        "created": 0, "duplicates": 0, "skipped": 0, "errors": [],
        "categorized": {"history": 0, "rules": 0, "unclassified": 0},
    }
    reader = csv.DictReader(io.StringIO(text))
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    if BANK_HEADERS.issubset(headers):
        merchant_col, neg_col, pos_col = "transaction_detail", "withdrawal", "deposit"
    elif CC_HEADERS.issubset(headers):
        merchant_col, neg_col, pos_col = "merchant", "amount", "payment"
    else:
        summary["errors"].append({
            "row": 0,
            "reason": (
                "Unrecognized CSV. Expected bank columns "
                f"({', '.join(sorted(BANK_HEADERS))}) or credit-card columns "
                f"({', '.join(sorted(CC_HEADERS))})."
            ),
        })
        return summary

    transfer_categories = {
        c.id for c in session.exec(select(Category)).all() if c.group == "transfers"
    }

    for i, raw in enumerate(reader, start=1):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            date = normalize_date(row["date"])
            amount = _parse_amount(row, neg_col, pos_col)
            raw_merchant = row[merchant_col]
            if not raw_merchant:
                raise ValueError(f"missing {merchant_col}")
            account_id = row["account"]
            if not session.get(Account, account_id):
                raise ValueError(f"unknown account: {account_id!r} (must match an existing account id)")
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            continue

        existing = session.exec(select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.date == date,
            Transaction.raw_merchant == raw_merchant,
            Transaction.amount == amount,
        )).first()
        if existing:
            summary["duplicates"] += 1
            continue

        merchant = _clean_merchant(raw_merchant)
        category_id, method = categorize(session, raw_merchant, merchant)
        running = row.get("running_total", "")
        session.add(Transaction(
            id=new_id("tx"), account_id=account_id, date=date,
            raw_merchant=raw_merchant, merchant=merchant, amount=amount,
            category_id=category_id,
            is_transfer=category_id in transfer_categories,
            running_total=float(running) if running else None,
        ))
        session.commit()
        summary["created"] += 1
        summary["categorized"][method] += 1

    return summary
```

Note the per-row commit: it makes rows inserted earlier in the same file visible to `categorize`'s history lookup, so the second occurrence of a merchant in one import history-matches the first (matches the summary counts in the tests).

- [ ] **Step 4: Add the endpoint to `backend/app/routers/imports.py`**

```python
from ..services.transactions_csv import import_transactions_csv


@router.post("/transactions-csv")
async def import_transactions_csv_endpoint(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    text = (await file.read()).decode("utf-8-sig")
    return import_transactions_csv(text, session)
```

- [ ] **Step 5: Run the tests, then the real sample files end-to-end**

Run: `uv run pytest tests/test_transactions_csv.py -v` then `uv run pytest -q` — all pass.

Then a real-file smoke test (dev DB freshly seeded, uvicorn running):

```bash
curl -s -F "file=@../mock/out/credit_card.csv" http://localhost:8000/api/import/transactions-csv
```

Expected: high `duplicates` count (the mock CSVs overlap the seeded fixture transactions — that's the dedup working; the seeded fixture rows and CSV rows share account ids, dates, raw merchants, and amounts). Stop the server after.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/transactions_csv.py backend/app/routers/imports.py backend/tests/test_transactions_csv.py
git commit -m "feat(m3): bank/credit-card CSV import — sniffed formats, dedup, auto-categorization"
```

---

### Task 9: Frontend — persisted reclassify + transaction edits (seam + store)

**Files:**
- Modify: `frontend/src/data/api.ts`
- Modify: `frontend/src/store/useAppStore.ts`
- Test: `frontend/src/store/__tests__/useAppStore.transactions.test.ts` (new)

**Interfaces:**
- Consumes: Task 5's PATCH endpoint; Task 6's rules endpoints; Task 8's import endpoint.
- Produces (api.ts): `updateTransaction(id, b)`, `listRules()`, `createRule(b)`, `updateRule(id, b)`, `deleteRule(id)`, `importTransactionsCsv(file)`, types `RuleRow`, `TxImportSummary`, `TransactionPatchInput`.
- Produces (store): async `reclassifyTransaction(txId, categoryId)` (optimistic + persist), `editTransaction(id, patch)`, `rules: RuleRow[]`, `loadRules()`, `addRule(b)`, `editRule(id, b)`, `removeRule(id)`, `importTransactionsFile(file)`. Tasks 10–12 consume these exact names.

- [ ] **Step 1: Add the API methods**

Append to `frontend/src/data/api.ts` (after the contributions block):

```ts
import type { Transaction } from '../types';

export interface TransactionPatchInput {
  categoryId?: string;
  isTransfer?: boolean;
  isDuplicate?: boolean;
  notes?: string;   // '' clears
  tags?: string[];  // [] clears
}

export const updateTransaction = (id: string, b: TransactionPatchInput) =>
  send<Transaction>('PATCH', `/api/transactions/${id}`, b);

export interface RuleRow { id: string; keyword: string; categoryId: string; createdAt: string }

export const listRules = () => send<RuleRow[]>('GET', '/api/rules');
export const createRule = (b: { keyword: string; categoryId: string }) =>
  send<RuleRow>('POST', '/api/rules', b);
export const updateRule = (id: string, b: { keyword?: string; categoryId?: string }) =>
  send<RuleRow>('PUT', `/api/rules/${id}`, b);
export const deleteRule = (id: string) => send<void>('DELETE', `/api/rules/${id}`);

export interface TxImportSummary {
  created: number; duplicates: number; skipped: number;
  errors: { row: number; reason: string }[];
  categorized: { history: number; rules: number; unclassified: number };
}

export async function importTransactionsCsv(file: File): Promise<TxImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return json<TxImportSummary>(
    await fetch(`${BASE}/api/import/transactions-csv`, { method: 'POST', body: fd }),
  );
}
```

- [ ] **Step 2: Write the failing store test**

Create `frontend/src/store/__tests__/useAppStore.transactions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  updateTransaction: vi.fn().mockResolvedValue({}),
  createRule: vi.fn().mockResolvedValue({ id: 'r1', keyword: 'costco', categoryId: 'dining', createdAt: 'x' }),
  listRules: vi.fn().mockResolvedValue([]),
}));

import * as api from '../../data/api';
import { useAppStore } from '../useAppStore';
import type { Fixtures } from '../../types';

const fixtures = {
  transactions: [
    { id: 't1', date: '2026-01-05', accountId: 'chq', rawMerchant: 'COSTCO', merchant: 'Costco', amount: -50, categoryId: 'groceries' },
  ],
  categories: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] },
  craLimits: {}, meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  useAppStore.setState({ fixtures, loaded: true, rules: [] });
});

describe('reclassifyTransaction', () => {
  it('applies optimistically, persists via PATCH, then refetches', async () => {
    await useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { categoryId: 'dining' });
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('optimistic update is visible before the PATCH resolves', () => {
    // don't await — check synchronous state change
    void useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(useAppStore.getState().fixtures!.transactions[0]!.categoryId).toBe('dining');
  });
});

describe('rules', () => {
  it('addRule posts then reloads the rules list', async () => {
    await useAppStore.getState().addRule({ keyword: 'costco', categoryId: 'dining' });
    expect(api.createRule).toHaveBeenCalledWith({ keyword: 'costco', categoryId: 'dining' });
    expect(api.listRules).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/store/__tests__/useAppStore.transactions.test.ts`
Expected: FAIL — `rules` not in state, `reclassifyTransaction` not async / `addRule` undefined (TypeScript may fail compile first; that counts as the red step).

- [ ] **Step 4: Update the store**

In `frontend/src/store/useAppStore.ts`:

Add to the interface (replace the existing `reclassifyTransaction` line):

```ts
  reclassifyTransaction: (txId: string, categoryId: CategoryId) => Promise<void>;
  editTransaction: (id: string, b: import('../data/api').TransactionPatchInput) => Promise<void>;
  rules: import('../data/api').RuleRow[];
  loadRules: () => Promise<void>;
  addRule: (b: { keyword: string; categoryId: string }) => Promise<void>;
  editRule: (id: string, b: { keyword?: string; categoryId?: string }) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  importTransactionsFile: (file: File) => Promise<import('../data/api').TxImportSummary>;
```

Replace the `reclassifyTransaction` implementation and add the new actions (state init gains `rules: [],`):

```ts
  rules: [],

  reclassifyTransaction: async (txId, categoryId) => {
    const f = get().fixtures;
    if (!f) return;
    // Optimistic: swap the category locally so the UI is instant, then persist.
    const txs: Transaction[] = f.transactions.map((t) =>
      t.id === txId ? { ...t, categoryId } : t,
    );
    set({ fixtures: { ...f, transactions: txs } });
    try {
      await api.updateTransaction(txId, { categoryId });
    } finally {
      await get().refetch(); // success: confirm; failure: revert to server truth
    }
  },

  editTransaction: async (id, b) => { await api.updateTransaction(id, b); await get().refetch(); },

  loadRules: async () => { set({ rules: await api.listRules() }); },
  addRule: async (b) => { await api.createRule(b); await get().loadRules(); },
  editRule: async (id, b) => { await api.updateRule(id, b); await get().loadRules(); },
  removeRule: async (id) => { await api.deleteRule(id); await get().loadRules(); },
  importTransactionsFile: async (file) => {
    const summary = await api.importTransactionsCsv(file);
    await get().refetch();
    return summary;
  },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: all green. (`Transactions.tsx` still calls `reclassify(t.id, value)` — a now-floating promise from an event handler, which TypeScript allows; the page gets its upgrade in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/data/api.ts frontend/src/store/useAppStore.ts frontend/src/store/__tests__/useAppStore.transactions.test.ts
git commit -m "feat(m3): persisted reclassify + rules/import methods through the api seam"
```

---

### Task 10: Transactions page — rule prompt + notes/tags/flags editor

**Files:**
- Modify: `frontend/src/pages/Transactions.tsx`

**Interfaces:**
- Consumes: store `reclassifyTransaction`, `editTransaction`, `addRule` (Task 9); `components/ui/Button`.

- [ ] **Step 1: Add state + the rule prompt to `Transactions()`**

In `frontend/src/pages/Transactions.tsx`, extend the component top:

```ts
  const editTransaction = useAppStore((s) => s.editTransaction);
  const addRule = useAppStore((s) => s.addRule);

  // After a reclassify, offer to make it a rule ("Always categorize X as Y?").
  const [rulePrompt, setRulePrompt] = useState<{ txId: string; merchant: string; categoryId: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
```

Replace the category `<select>`'s `onChange` with:

```ts
onChange={(e) => {
  void reclassify(t.id, e.target.value);
  setRulePrompt({ txId: t.id, merchant: t.merchant, categoryId: e.target.value });
}}
```

Under the `<CategoryBadge>` line (inside the same `<td>`), render the prompt when it targets this row:

```tsx
{rulePrompt?.txId === t.id && (
  <div className="mt-1 flex items-center gap-2 text-xs text-ink-dim">
    <span>
      Always categorize “{rulePrompt.merchant}” as {catById.get(rulePrompt.categoryId)?.name ?? rulePrompt.categoryId}?
    </span>
    <Button
      variant="ghost"
      onClick={() => {
        void addRule({ keyword: rulePrompt.merchant, categoryId: rulePrompt.categoryId });
        setRulePrompt(null);
      }}
    >
      Create rule
    </Button>
    <Button variant="ghost" onClick={() => setRulePrompt(null)}>Dismiss</Button>
  </div>
)}
```

- [ ] **Step 2: Add the expandable row editor**

Make the merchant cell toggle expansion — on the merchant `<td>`, add `onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}` and `cursor-pointer` to its className. After the main `<tr>` (inside the `rows.map` — wrap the pair in a `<Fragment key={t.id}>` and move the `key` off the `<tr>`), render:

```tsx
{expandedId === t.id && (
  <tr className="bg-bg-elev/50">
    <td colSpan={5} className="py-3 px-4">
      <TxEditor
        tx={t}
        onSave={async (patch) => {
          await editTransaction(t.id, patch);
          setExpandedId(null);
        }}
      />
    </td>
  </tr>
)}
```

Add `import { Fragment } from 'react';` (or use `useState`'s existing react import line) and the editor component at the bottom of the file:

```tsx
function TxEditor({
  tx,
  onSave,
}: {
  tx: import('../types').Transaction;
  onSave: (patch: import('../data/api').TransactionPatchInput) => Promise<void>;
}) {
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [tags, setTags] = useState((tx.tags ?? []).join(', '));
  const [isTransfer, setIsTransfer] = useState(tx.isTransfer ?? false);
  const [isDuplicate, setIsDuplicate] = useState(tx.isDuplicate ?? false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2 text-ink-muted">
        Notes
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="bg-bg-elev border border-line rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand w-56"
        />
      </label>
      <label className="flex items-center gap-2 text-ink-muted">
        Tags
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="comma, separated"
          className="bg-bg-elev border border-line rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand w-48"
        />
      </label>
      <label className="flex items-center gap-1.5 text-ink-muted">
        <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />
        Transfer
      </label>
      <label className="flex items-center gap-1.5 text-ink-muted">
        <input type="checkbox" checked={isDuplicate} onChange={(e) => setIsDuplicate(e.target.checked)} />
        Duplicate
      </label>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave({
              notes,
              tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
              isTransfer,
              isDuplicate,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + run all frontend tests**

Run: `npm run typecheck` then `npx vitest run`
Expected: green.

- [ ] **Step 4: Manual smoke (backend seeded + running, `npm run dev` — read the ACTUAL port from its output)**

Reclassify a transaction → rule prompt appears → reload the page → category persisted. Expand a row → set notes → Save → reload → notes persisted.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions.tsx
git commit -m "feat(m3): transactions page — persisted reclassify prompt-to-rule, notes/tags/flags editor"
```

---

### Task 11: Import page — transactions CSV card

**Files:**
- Modify: `frontend/src/pages/Import.tsx`

**Interfaces:**
- Consumes: store `importTransactionsFile` (Task 9), `TxImportSummary` type.
- Note: the spec (§9.3) placed this card in Settings; the app already has a dedicated Import page carrying the investments card, so it goes there — update the spec line in Task 13.

- [ ] **Step 1: Restructure `Import.tsx` into two cards**

Rename the existing component body into `InvestmentsImportCard()` (unchanged logic) and add a transactions card; `Import()` renders both in a `space-y-6` div:

```tsx
export function Import() {
  return (
    <div className="space-y-6">
      <InvestmentsImportCard />
      <TransactionsImportCard />
    </div>
  );
}

function TransactionsImportCard() {
  const importTransactionsFile = useAppStore((s) => s.importTransactionsFile);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<TxImportSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setError(''); setBusy(true); setSummary(null);
    try {
      setSummary(await importTransactionsFile(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold text-ink mb-2">Import bank / credit-card CSV</h1>
      <p className="text-sm text-ink-dim mb-3">
        Auto-detected formats: bank (<code>Date, Transaction_detail, withdrawal, deposit, running_total, account</code>)
        or credit card (<code>Date, merchant, amount, payment, running_total, account</code>).
        The <code>account</code> column must match an existing account id. Re-importing the same rows is safe — duplicates are skipped.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input type="file" accept=".csv,text/csv" className="text-sm text-ink-muted" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button onClick={run} disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
      {error && <p className="text-down text-sm">{error}</p>}
      {summary && (
        <div className="text-sm text-ink-muted">
          <p>
            Created {summary.created} · Duplicates {summary.duplicates} · Skipped {summary.skipped}
          </p>
          <p className="text-xs text-ink-dim mt-1">
            Categorized — history {summary.categorized.history} · rules {summary.categorized.rules} · unclassified {summary.categorized.unclassified}
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 text-down list-disc pl-5">
              {summary.errors.map((er, idx) => <li key={idx}>Row {er.row}: {er.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
```

Add `import type { TxImportSummary } from '../data/api';` to the imports.

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck` then `npx vitest run`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Import.tsx
git commit -m "feat(m3): transactions CSV import card on the Import page"
```

---

### Task 12: Settings — categorization rules card

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`
- Test: `frontend/src/pages/__tests__/RulesSection.test.tsx` (new)

**Interfaces:**
- Consumes: store `rules`, `loadRules`, `addRule`, `editRule`, `removeRule` (Task 9).

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/pages/__tests__/RulesSection.test.tsx` (same `createRoot` + `act` pattern as `Topbar.test.tsx`; the store is set directly, api mocked):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  listRules: vi.fn().mockResolvedValue([]),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}));

import { useAppStore } from '../../store/useAppStore';
import { RulesSection } from '../Settings';
import type { Fixtures } from '../../types';

const fixtures = {
  categories: [
    { id: 'groceries', name: 'Groceries', group: 'essentials' },
    { id: 'dining', name: 'Dining', group: 'lifestyle' },
  ],
  transactions: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] }, craLimits: {},
  meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RulesSection', () => {
  it('lists rules with keyword and category name', async () => {
    useAppStore.setState({
      fixtures, loaded: true,
      rules: [{ id: 'r1', keyword: 'costco', categoryId: 'groceries', createdAt: '2026-01-01' }],
    });
    await act(async () => root.render(<RulesSection />));
    expect(container.textContent).toContain('costco');
    expect(container.textContent).toContain('Groceries');
  });

  it('shows the empty state when no rules exist', async () => {
    useAppStore.setState({ fixtures, loaded: true, rules: [] });
    await act(async () => root.render(<RulesSection />));
    expect(container.textContent).toContain('No rules yet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/RulesSection.test.tsx`
Expected: FAIL — `RulesSection` is not exported from Settings.

- [ ] **Step 3: Add `RulesSection` to `Settings.tsx`**

Add an exported section component alongside `HouseholdSection` (export needed for the test):

```tsx
export function RulesSection() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const rules = useAppStore((s) => s.rules);
  const loadRules = useAppStore((s) => s.loadRules);
  const addRule = useAppStore((s) => s.addRule);
  const editRule = useAppStore((s) => s.editRule);
  const removeRule = useAppStore((s) => s.removeRule);

  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState(fixtures.categories[0]?.id ?? '');
  const [error, setError] = useState('');

  useEffect(() => { void loadRules(); }, [loadRules]);

  const catById = new Map(fixtures.categories.map((c) => [c.id, c]));

  async function submit() {
    setError('');
    try {
      await addRule({ keyword, categoryId });
      setKeyword('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="keyword, e.g. costco"
          className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-48"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
        >
          {fixtures.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button onClick={() => void submit()} disabled={!keyword.trim()}>Add rule</Button>
      </div>
      {error && <p className="text-down text-sm">{error}</p>}
      {rules.length === 0 ? (
        <p className="text-sm text-ink-dim">No rules yet — reclassify a transaction and choose “Create rule”, or add one above.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="py-2 text-ink">{r.keyword}</td>
                <td className="py-2">
                  <select
                    value={r.categoryId}
                    onChange={(e) => void editRule(r.id, { categoryId: e.target.value })}
                    className="bg-transparent border-0 text-xs focus:outline-none cursor-pointer text-ink-muted hover:text-ink"
                  >
                    {fixtures.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right text-xs text-ink-dim">{catById.get(r.categoryId)?.group}</td>
                <td className="py-2 text-right">
                  <Button variant="ghost" onClick={() => void removeRule(r.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

(Reuse Settings' existing imports; add `useEffect` to the react import if not already there.)

In `Settings()`, render it after the Categories card:

```tsx
<Card title="Categorization rules" subtitle="keyword → category, applied to CSV imports (newest rule wins)">
  <RulesSection />
</Card>
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run` then `npm run typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/pages/__tests__/RulesSection.test.tsx
git commit -m "feat(m3): categorization-rules management card in Settings"
```

---

### Task 13: Docs refresh + full-suite gate

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-16-m3-editable-transactions-design.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- "Current state" paragraph: M3 shipped — the entire `/api/data` payload is DB-backed; transactions editable (category/flags/notes/tags); bank & credit-card CSV import with dedup; history+rules auto-categorization. Point at the M3 spec path.
- Known gaps: remove the "banking read-only / reclassify in-memory" line; keep `date-fns` unused; add "categories & budgets are in the DB but not yet editable (candidate M4)".
- Architecture section: note `mock/generate.py → fixtures.json` is now **seed input only** (`uv run seed.py`), not a runtime dependency.

- [ ] **Step 2: Fix spec §9.3**

In the spec, change the "Settings — Import transactions CSV card" feature line to say the card lives on the **Import page** (next to the existing investments card), with a one-line note that Settings was superseded by the app's existing dedicated Import page.

- [ ] **Step 3: Full gates**

```bash
# from backend/
uv run pytest -q
# from frontend/
npm run typecheck
npx vitest run
npm run build
```

Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-16-m3-editable-transactions-design.md
git commit -m "docs(m3): CLAUDE.md current-state refresh; spec import-card location fix"
```

---

## After the plan

Live verification (verify skill, Playwright): seed fresh DB → reclassify survives reload → create rule via prompt → import `mock/out/credit_card.csv` (expect mostly duplicates against seeded data) → craft a small novel CSV and confirm rule/history categorization → purge demo restores. Then push and open the PR to `main`.
