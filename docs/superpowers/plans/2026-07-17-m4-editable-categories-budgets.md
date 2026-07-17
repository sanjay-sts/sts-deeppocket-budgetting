# M4 — Editable Categories, Budgets & Cash Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Category CRUD with cascade delete, real budget editing (caps/rollover/mode/lines), manual "cash" transactions (create/edit/delete), toast-on-failed-write, rule keyword editing in the UI, and a merchant index.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-17-m4-editable-categories-budgets-design.md`. Backend adds two routers (`categories`, `budget`) and extends the transactions router; one schema change (`Transaction.source` + merchant index) plus a seeded Cash wallet account. Frontend adds seam methods in `data/api.ts`, store actions with a toast slice in `useAppStore.ts`, a Categories card in Settings, inline editing on Budgets, and an add-transaction form on Transactions.

**Tech Stack:** FastAPI + SQLModel + SQLite (uv), pytest; React 18 + TypeScript strict + Zustand + Tailwind, Vitest.

## Global Constraints

- Data enters the frontend through exactly one seam: `frontend/src/data/api.ts`. Screens never fetch.
- `lib/kpi.ts` / `lib/canadian.ts` stay pure (no fetch/store access).
- TypeScript strict; no `any`. New shared types go in `frontend/src/types/index.ts`.
- Bank-imported transactions (`source='bank'`) keep immutable bank facts: PATCHing `date/merchant/amount/accountId` on them → 422; DELETE on them → 422. Manual rows (`source='manual'`) are fully editable and deletable.
- The `unclassified` category is protected: PATCH/DELETE → 422; it cannot get a budget line (422).
- Category DELETE cascade: transactions → `unclassified`, budget line deleted, rules targeting it deleted; response `{deleted, transactionsReassigned, rulesDeleted, budgetLineDeleted}`.
- Error policy (resolved spec ambiguity): store actions used by forms/cards **with their own inline error UI** (`addRule`, `editRule`, `removeRule`, `addCategory`, `editCategory`, `removeCategory`, `addTransaction`, existing people/account actions) **throw** — the component catches and renders inline. Fire-and-forget actions (`reclassifyTransaction`, `editTransaction`, `setBudgetMode`, `saveBudgetLine`, `removeBudgetLine`, `removeTransaction`) **never throw** — they `pushToast("Couldn't save … — changes reverted")` and refetch.
- Toast copy format exactly: `Couldn't save <what> — changes reverted` (em dash).
- Backend tests: `uv run pytest -q` from `backend/`. Frontend: `npx vitest run` and `npm run typecheck` from `frontend/`.
- **Schema changed ⇒ after this milestone a dev DB rebuild is mandatory:** delete `backend/deeppocket.db`, re-run `uv run seed.py`. The pytest suite uses an in-memory DB and is unaffected.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Rules **backend** already supports keyword editing (`PUT /api/rules/{id}`, 409 on case-insensitive duplicate, `backend/app/routers/rules.py:52`) — do NOT rebuild it; Task 9 is frontend-only.

---

### Task 1: Schema — `Transaction.source`, merchant index, `cash` kind, Cash wallet seed

**Files:**
- Modify: `backend/app/models.py:70-88` (Transaction)
- Modify: `backend/app/constants.py:5` (BANK_KINDS)
- Modify: `backend/app/services/fixtures.py:68-86` (`_transaction_out`)
- Modify: `backend/seed.py:122-153` (`_seed_banking`)
- Test: `backend/tests/test_seed_banking.py` (extend), `backend/tests/test_fixtures_payload.py` (extend)

**Interfaces:**
- Consumes: existing `_upsert`, `_seed_banking`, `_transaction_out`.
- Produces: `Transaction.source: str` (default `"bank"`), `Transaction.merchant` indexed, `BANK_KINDS` includes `"cash"`, seeded account `cash_wallet` (kind `cash`, institution `Cash`, $0 opening, adult owners), payload transactions carry `"source"`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_seed_banking.py` (match the file's existing imports/fixtures — it already imports `seed` and uses the `session` fixture):

```python
def test_seed_creates_cash_wallet(session):
    seed(session)
    wallet = session.get(Account, "cash_wallet")
    assert wallet is not None
    assert wallet.kind == "cash"
    assert wallet.institution == "Cash"
    assert wallet.custom_name == "Cash"
    assert wallet.opening_balance == 0.0
    owners = session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "cash_wallet")
    ).all()
    adults = {p.id for p in session.exec(select(Person)).all() if p.role == "adult"}
    assert {o.person_id for o in owners} == adults


def test_cash_wallet_seed_is_idempotent(session):
    seed(session)
    seed(session)
    owners = session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "cash_wallet")
    ).all()
    assert len(owners) == len({o.person_id for o in owners})


def test_seeded_transactions_have_bank_source(session):
    seed(session)
    txs = session.exec(select(Transaction)).all()
    assert txs and all(t.source == "bank" for t in txs)
```

Add the missing model imports (`Account`, `AccountOwner`, `Person`, `Transaction`) to the test file's import list if absent.

Append to `backend/tests/test_fixtures_payload.py` (it already builds a payload from a seeded session):

```python
def test_payload_transactions_include_source_and_cash_opening_balance(session):
    seed(session)
    payload = build_payload(session)
    assert all(t["source"] == "bank" for t in payload["transactions"])
    assert "cash_wallet" in payload["meta"]["openingBalances"]
```

(Adapt the seeding call to that file's existing helper if it uses one.)

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `uv run pytest tests/test_seed_banking.py tests/test_fixtures_payload.py -q`
Expected: FAIL — `AttributeError: ... no attribute 'source'` / cash_wallet missing.

- [ ] **Step 3: Implement**

`backend/app/models.py` — in `Transaction`, index merchant and add source:

```python
    raw_merchant: str
    merchant: str = Field(index=True)   # categorization history scans by merchant
```

and after `running_total`:

```python
    running_total: Optional[float] = None
    source: str = Field(default="bank")  # 'bank' (seed/CSV, immutable facts) | 'manual' (user-entered, fully editable)
```

`backend/app/constants.py:5`:

```python
BANK_KINDS = {"chequing", "savings", "credit_card", "cash"}
```

`backend/app/services/fixtures.py` — in `_transaction_out`, make source always present (add right after `"categoryId"` line, before the conditionals):

```python
    out["source"] = t.source
```

`backend/seed.py` — at the end of the bank-accounts loop in `_seed_banking` (after its `session.commit()` at line 153), add:

```python
    # Cash wallet for manual (cash) transactions — always present, $0 opening,
    # owned by the adults. custom_name pins the display name to just "Cash".
    _upsert(session, Account, "cash_wallet", {
        "institution": "Cash",
        "account_type": "cash",
        "kind": "cash",
        "custom_name": "Cash",
        "is_liability": False,
        "opening_balance": 0.0,
    })
    for row in session.exec(
        select(AccountOwner).where(AccountOwner.account_id == "cash_wallet")
    ).all():
        session.delete(row)
    for p in base["household"]:
        if p["role"] == "adult":
            session.add(AccountOwner(account_id="cash_wallet", person_id=p["id"]))
    session.commit()
```

- [ ] **Step 4: Run the backend suite**

Run: `uv run pytest -q`
Expected: all pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/constants.py backend/app/services/fixtures.py backend/seed.py backend/tests/test_seed_banking.py backend/tests/test_fixtures_payload.py
git commit -m "feat(m4): Transaction.source + merchant index, cash kind, seeded cash wallet"
```

---

### Task 2: Categories router — POST / PATCH / DELETE with cascade

**Files:**
- Create: `backend/app/routers/categories.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py` (register router)
- Test: `backend/tests/test_categories.py` (create)

**Interfaces:**
- Consumes: `Category`, `Transaction`, `Rule`, `BudgetLine` models; `UNCLASSIFIED` from `..services.categorize`; `_category_out` from `..services.fixtures`.
- Produces: `POST /api/categories` → category dict; `PATCH /api/categories/{id}` → category dict; `DELETE /api/categories/{id}` → `{"deleted": true, "transactionsReassigned": int, "rulesDeleted": int, "budgetLineDeleted": bool}`. Schemas `CategoryCreate`, `CategoryPatch`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_categories.py`:

```python
from app.models import BudgetLine, Category, Rule, Transaction


def _seed(session):
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials", bucket503020="needs"))
    session.add(Transaction(
        id="t1", account_id="chq", date="2026-01-05", raw_merchant="COSTCO",
        merchant="Costco", amount=-50.0, category_id="groceries",
    ))
    session.add(Rule(id="r1", keyword="costco", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.add(BudgetLine(category_id="groceries", monthly_cap=900.0, rollover=True))
    session.commit()


def test_create_category_slugs_and_returns_wire_shape(client, session):
    _seed(session)
    r = client.post("/api/categories", json={"name": "Pet Care!", "group": "family", "bucket503020": "wants"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "pet_care"
    assert body["name"] == "Pet Care!"
    assert body["group"] == "family"
    assert body["bucket503020"] == "wants"


def test_create_duplicate_name_is_409_case_insensitive(client, session):
    _seed(session)
    r = client.post("/api/categories", json={"name": "GROCERIES", "group": "essentials"})
    assert r.status_code == 409


def test_create_rejects_bad_group_and_bucket(client, session):
    _seed(session)
    assert client.post("/api/categories", json={"name": "X", "group": "nope"}).status_code == 422
    assert client.post("/api/categories", json={"name": "X", "group": "family", "bucket503020": "later"}).status_code == 422


def test_patch_updates_fields_and_clears_bucket(client, session):
    _seed(session)
    r = client.patch("/api/categories/groceries", json={"name": "Food", "bucket503020": ""})
    assert r.status_code == 200
    assert r.json()["name"] == "Food"
    assert "bucket503020" not in r.json()


def test_patch_rename_collision_is_409(client, session):
    _seed(session)
    client.post("/api/categories", json={"name": "Dining", "group": "lifestyle"})
    assert client.patch("/api/categories/groceries", json={"name": "dining"}).status_code == 409


def test_patch_rejects_extra_fields(client, session):
    _seed(session)
    assert client.patch("/api/categories/groceries", json={"id": "hack"}).status_code == 422


def test_delete_cascades_and_reports_counts(client, session):
    _seed(session)
    r = client.delete("/api/categories/groceries")
    assert r.status_code == 200
    assert r.json() == {
        "deleted": True, "transactionsReassigned": 1,
        "rulesDeleted": 1, "budgetLineDeleted": True,
    }
    session.expire_all()
    assert session.get(Transaction, "t1").category_id == "unclassified"
    assert session.get(Rule, "r1") is None
    assert session.get(BudgetLine, "groceries") is None
    assert session.get(Category, "groceries") is None


def test_unclassified_is_protected(client, session):
    _seed(session)
    assert client.delete("/api/categories/unclassified").status_code == 422
    assert client.patch("/api/categories/unclassified", json={"name": "X"}).status_code == 422


def test_unknown_category_404(client, session):
    _seed(session)
    assert client.patch("/api/categories/nope", json={"name": "X"}).status_code == 404
    assert client.delete("/api/categories/nope").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_categories.py -q`
Expected: FAIL with 404s (router not registered).

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    group: str
    bucket503020: Optional[str] = None
    isEssential: bool = False


class CategoryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    group: Optional[str] = None
    bucket503020: Optional[str] = None  # "" clears
    isEssential: Optional[bool] = None
```

- [ ] **Step 4: Create the router**

Create `backend/app/routers/categories.py`:

```python
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import BudgetLine, Category, Rule, Transaction
from ..schemas import CategoryCreate, CategoryPatch
from ..services.categorize import UNCLASSIFIED
from ..services.fixtures import _category_out

router = APIRouter(prefix="/api/categories", tags=["categories"])

VALID_GROUPS = {"essentials", "lifestyle", "family", "financial", "transfers", "income"}
VALID_BUCKETS = {"needs", "wants", "savings"}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def _check_name_clash(session: Session, name: str, exclude_id: str | None = None) -> None:
    clash = next(
        (c for c in session.exec(select(Category)).all()
         if c.name.lower() == name.lower() and c.id != exclude_id),
        None,
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"A category named {name!r} already exists")


def _check_group(group: str) -> None:
    if group not in VALID_GROUPS:
        raise HTTPException(status_code=422, detail=f"Unknown group: {group}")


def _check_bucket(bucket: str) -> None:
    if bucket and bucket not in VALID_BUCKETS:
        raise HTTPException(status_code=422, detail=f"Unknown 50/30/20 bucket: {bucket}")


@router.post("")
def create_category(body: CategoryCreate, session: Session = Depends(get_session)) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    _check_group(body.group)
    if body.bucket503020 is not None:
        _check_bucket(body.bucket503020)
    cat_id = _slug(name)
    if not cat_id:
        raise HTTPException(status_code=422, detail="Name must contain letters or digits")
    _check_name_clash(session, name)
    if session.get(Category, cat_id):
        raise HTTPException(status_code=409, detail=f"A category with id {cat_id!r} already exists")
    cat = Category(
        id=cat_id, name=name, group=body.group,
        bucket503020=body.bucket503020 or None, is_essential=body.isEssential,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return _category_out(cat)


@router.patch("/{cat_id}")
def patch_category(cat_id: str, body: CategoryPatch, session: Session = Depends(get_session)) -> dict:
    if cat_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be edited")
    cat = session.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name must not be empty")
        _check_name_clash(session, name, exclude_id=cat_id)
        cat.name = name
    if body.group is not None:
        _check_group(body.group)
        cat.group = body.group
    if body.bucket503020 is not None:
        _check_bucket(body.bucket503020)
        cat.bucket503020 = body.bucket503020 or None
    if body.isEssential is not None:
        cat.is_essential = body.isEssential
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return _category_out(cat)


@router.delete("/{cat_id}")
def delete_category(cat_id: str, session: Session = Depends(get_session)) -> dict:
    if cat_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be deleted")
    cat = session.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    txs = session.exec(select(Transaction).where(Transaction.category_id == cat_id)).all()
    for t in txs:
        t.category_id = UNCLASSIFIED
        session.add(t)
    rules = session.exec(select(Rule).where(Rule.category_id == cat_id)).all()
    for r in rules:
        session.delete(r)
    line = session.get(BudgetLine, cat_id)
    if line:
        session.delete(line)
    session.delete(cat)
    session.commit()
    return {
        "deleted": True,
        "transactionsReassigned": len(txs),
        "rulesDeleted": len(rules),
        "budgetLineDeleted": line is not None,
    }
```

Register in `backend/app/main.py` — extend the import line and add after the rules router:

```python
from .routers import data, people, accounts, snapshots, imports, contributions, admin, transactions, rules, categories, budget
```

```python
app.include_router(categories.router)
```

(The `budget` import lands in Task 3 — if implementing Task 2 alone, import only `categories` and let Task 3 extend the line.)

- [ ] **Step 5: Run tests**

Run: `uv run pytest tests/test_categories.py -q` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/categories.py backend/app/schemas.py backend/app/main.py backend/tests/test_categories.py
git commit -m "feat(m4): category CRUD with cascade delete to unclassified"
```

---

### Task 3: Budget router — line upsert/delete, config patch

**Files:**
- Create: `backend/app/routers/budget.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py` (register)
- Test: `backend/tests/test_budget.py` (create)

**Interfaces:**
- Consumes: `BudgetLine`, `BudgetConfig`, `Category` models; `UNCLASSIFIED`.
- Produces: `PUT /api/budget/lines/{categoryId}` → `{"categoryId", "monthlyCap", "rollover"}`; `DELETE /api/budget/lines/{categoryId}` → 204; `PATCH /api/budget/config` → `{"mode", "targetSavingsRate"?}`. Schemas `BudgetLineUpsert`, `BudgetConfigPatch`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_budget.py`:

```python
from app.models import BudgetConfig, BudgetLine, Category


def _seed(session):
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(BudgetConfig(id=1, mode="envelope"))
    session.commit()


def test_put_line_creates_then_updates(client, session):
    _seed(session)
    r = client.put("/api/budget/lines/groceries", json={"monthlyCap": 900, "rollover": True})
    assert r.status_code == 200
    assert r.json() == {"categoryId": "groceries", "monthlyCap": 900.0, "rollover": True}
    r = client.put("/api/budget/lines/groceries", json={"monthlyCap": 750, "rollover": False})
    assert r.json()["monthlyCap"] == 750.0
    session.expire_all()
    assert session.get(BudgetLine, "groceries").rollover is False


def test_put_line_validation(client, session):
    _seed(session)
    assert client.put("/api/budget/lines/groceries", json={"monthlyCap": -5, "rollover": False}).status_code == 422
    assert client.put("/api/budget/lines/unclassified", json={"monthlyCap": 10, "rollover": False}).status_code == 422
    assert client.put("/api/budget/lines/nope", json={"monthlyCap": 10, "rollover": False}).status_code == 404


def test_delete_line(client, session):
    _seed(session)
    client.put("/api/budget/lines/groceries", json={"monthlyCap": 900, "rollover": True})
    assert client.delete("/api/budget/lines/groceries").status_code == 204
    assert client.delete("/api/budget/lines/groceries").status_code == 404


def test_patch_config(client, session):
    _seed(session)
    r = client.patch("/api/budget/config", json={"mode": "zero_based"})
    assert r.status_code == 200
    assert r.json()["mode"] == "zero_based"
    assert client.patch("/api/budget/config", json={"mode": "vibes"}).status_code == 422
    assert client.patch("/api/budget/config", json={"targetSavingsRate": 1.5}).status_code == 422
    r = client.patch("/api/budget/config", json={"targetSavingsRate": 0.25})
    assert r.json()["targetSavingsRate"] == 0.25
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_budget.py -q`
Expected: FAIL with 404s.

- [ ] **Step 3: Add schemas**

Append to `backend/app/schemas.py`:

```python
class BudgetLineUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    monthlyCap: float
    rollover: bool = False


class BudgetConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Optional[str] = None
    targetSavingsRate: Optional[float] = None
```

- [ ] **Step 4: Create the router**

Create `backend/app/routers/budget.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import BudgetConfig, BudgetLine, Category
from ..schemas import BudgetConfigPatch, BudgetLineUpsert
from ..services.categorize import UNCLASSIFIED

router = APIRouter(prefix="/api/budget", tags=["budget"])

VALID_MODES = {"envelope", "zero_based", "fifty_thirty_twenty"}


def _line_out(line: BudgetLine) -> dict:
    return {"categoryId": line.category_id, "monthlyCap": line.monthly_cap, "rollover": line.rollover}


@router.put("/lines/{category_id}")
def upsert_line(
    category_id: str, body: BudgetLineUpsert, session: Session = Depends(get_session)
) -> dict:
    if category_id == UNCLASSIFIED:
        raise HTTPException(status_code=422, detail="The unclassified category cannot be budgeted")
    if not session.get(Category, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    if body.monthlyCap < 0:
        raise HTTPException(status_code=422, detail="monthlyCap must be >= 0")
    line = session.get(BudgetLine, category_id)
    if line:
        line.monthly_cap = body.monthlyCap
        line.rollover = body.rollover
    else:
        line = BudgetLine(category_id=category_id, monthly_cap=body.monthlyCap, rollover=body.rollover)
    session.add(line)
    session.commit()
    session.refresh(line)
    return _line_out(line)


@router.delete("/lines/{category_id}", status_code=204)
def delete_line(category_id: str, session: Session = Depends(get_session)) -> None:
    line = session.get(BudgetLine, category_id)
    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")
    session.delete(line)
    session.commit()


@router.patch("/config")
def patch_config(body: BudgetConfigPatch, session: Session = Depends(get_session)) -> dict:
    cfg = session.get(BudgetConfig, 1) or BudgetConfig(id=1, mode="envelope")
    if body.mode is not None:
        if body.mode not in VALID_MODES:
            raise HTTPException(status_code=422, detail=f"Unknown budget mode: {body.mode}")
        cfg.mode = body.mode
    if body.targetSavingsRate is not None:
        if not 0 <= body.targetSavingsRate <= 1:
            raise HTTPException(status_code=422, detail="targetSavingsRate must be between 0 and 1")
        cfg.target_savings_rate = body.targetSavingsRate
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    out: dict = {"mode": cfg.mode}
    if cfg.target_savings_rate is not None:
        out["targetSavingsRate"] = cfg.target_savings_rate
    return out
```

Register in `backend/app/main.py` (extend the routers import to include `budget`, then):

```python
app.include_router(budget.router)
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest tests/test_budget.py -q` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/budget.py backend/app/schemas.py backend/app/main.py backend/tests/test_budget.py
git commit -m "feat(m4): budget line upsert/delete and config patch endpoints"
```

---

### Task 4: Transactions — POST (manual), DELETE, PATCH extension for manual facts

**Files:**
- Modify: `backend/app/routers/transactions.py`, `backend/app/schemas.py` (TransactionPatch + new TransactionCreate)
- Test: `backend/tests/test_transactions_manual.py` (create); `backend/tests/test_transactions_patch.py` (verify still green — bank 422 behaviour must be preserved)

**Interfaces:**
- Consumes: `categorize(session, raw_merchant, merchant) -> (category_id, method)` from `..services.categorize`; `_transaction_out`; `Account`, `Category`, `Transaction` models.
- Produces: `POST /api/transactions` → transaction wire dict (with `"source": "manual"`); `DELETE /api/transactions/{id}` → 204; PATCH accepts `date/merchant/amount/accountId` on manual rows only. Schema `TransactionCreate`; `TransactionPatch` gains the four manual-only optional fields.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_transactions_manual.py`:

```python
from app.models import Account, Category, Rule, Transaction


def _seed(session):
    session.add(Account(id="cash_wallet", institution="Cash", account_type="cash", kind="cash", custom_name="Cash"))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(Rule(id="r1", keyword="farm", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.commit()


def _create(client, **overrides):
    body = {"accountId": "cash_wallet", "date": "2026-07-10", "merchant": "Farm Boy", "amount": -20.5}
    body.update(overrides)
    return client.post("/api/transactions", json=body)


def test_create_manual_with_explicit_category(client, session):
    _seed(session)
    r = _create(client, categoryId="groceries", notes="cash", tags=["market"])
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "manual"
    assert body["categoryId"] == "groceries"
    assert body["rawMerchant"] == "Farm Boy"
    assert body["tags"] == ["market"]
    assert body["id"].startswith("txn_m_")


def test_create_auto_categorizes_when_category_omitted(client, session):
    _seed(session)
    r = _create(client)
    assert r.json()["categoryId"] == "groceries"  # matched rule 'farm'


def test_create_validation(client, session):
    _seed(session)
    assert _create(client, accountId="nope").status_code == 404
    assert _create(client, date="07/10/2026").status_code == 422
    assert _create(client, merchant="  ").status_code == 422
    assert _create(client, amount=0).status_code == 422
    assert _create(client, categoryId="nope").status_code == 422


def test_patch_manual_facts_editable(client, session):
    _seed(session)
    tx_id = _create(client).json()["id"]
    r = client.patch(f"/api/transactions/{tx_id}", json={
        "date": "2026-07-11", "merchant": "Farmboy #2", "amount": -25.0, "accountId": "chq",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-07-11"
    assert body["merchant"] == "Farmboy #2"
    assert body["rawMerchant"] == "Farmboy #2"
    assert body["amount"] == -25.0
    assert body["accountId"] == "chq"


def test_patch_bank_facts_still_locked(client, session):
    _seed(session)
    session.add(Transaction(
        id="tb", account_id="chq", date="2026-01-05", raw_merchant="X",
        merchant="X", amount=-1.0, category_id="unclassified", source="bank",
    ))
    session.commit()
    for field, value in (("date", "2026-01-06"), ("merchant", "Y"), ("amount", -2.0), ("accountId", "cash_wallet")):
        assert client.patch("/api/transactions/tb", json={field: value}).status_code == 422


def test_delete_manual_only(client, session):
    _seed(session)
    tx_id = _create(client).json()["id"]
    session.add(Transaction(
        id="tb", account_id="chq", date="2026-01-05", raw_merchant="X",
        merchant="X", amount=-1.0, category_id="unclassified", source="bank",
    ))
    session.commit()
    assert client.delete(f"/api/transactions/{tx_id}").status_code == 204
    assert client.delete("/api/transactions/tb").status_code == 422
    assert client.delete("/api/transactions/nope").status_code == 404
```

Remove the stray guard line in `test_create_auto_categorizes_when_category_omitted` — the test body is just the two `r = _create(client)` / assert lines:

```python
def test_create_auto_categorizes_when_category_omitted(client, session):
    _seed(session)
    r = _create(client)
    assert r.json()["categoryId"] == "groceries"  # matched rule 'farm'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_transactions_manual.py -q`
Expected: FAIL — 405 (no POST route) / 422 from `extra="forbid"`.

- [ ] **Step 3: Extend schemas**

In `backend/app/schemas.py`, replace `TransactionPatch` with:

```python
class TransactionPatch(BaseModel):
    # Bank facts (date/amount/merchant/account) are immutable on source='bank' rows —
    # the router rejects them with 422. On source='manual' rows they are editable.
    # extra="forbid" still turns unknown fields into a 422 instead of a silent ignore.
    model_config = ConfigDict(extra="forbid")

    categoryId: Optional[str] = None
    isTransfer: Optional[bool] = None
    isDuplicate: Optional[bool] = None
    notes: Optional[str] = None      # "" clears
    tags: Optional[list[str]] = None  # [] clears
    # manual-only bank facts:
    date: Optional[str] = None
    merchant: Optional[str] = None
    amount: Optional[float] = None
    accountId: Optional[str] = None
```

Append:

```python
class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accountId: str
    date: str
    merchant: str
    amount: float
    categoryId: Optional[str] = None  # omitted -> auto-categorize
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
```

- [ ] **Step 4: Extend the router**

Replace `backend/app/routers/transactions.py` with:

```python
import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..models import Account, Category, Transaction
from ..schemas import TransactionCreate, TransactionPatch
from ..services.categorize import categorize
from ..services.fixtures import _transaction_out

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _check_date(date: str) -> None:
    if not ISO_DATE.fullmatch(date):
        raise HTTPException(status_code=422, detail=f"Date must be YYYY-MM-DD, got {date!r}")


@router.post("")
def create_transaction(body: TransactionCreate, session: Session = Depends(get_session)) -> dict:
    if not session.get(Account, body.accountId):
        raise HTTPException(status_code=404, detail=f"Unknown account: {body.accountId}")
    _check_date(body.date)
    merchant = body.merchant.strip()
    if not merchant:
        raise HTTPException(status_code=422, detail="Merchant must not be empty")
    if body.amount == 0:
        raise HTTPException(status_code=422, detail="Amount must not be zero")
    if body.categoryId is not None:
        if not session.get(Category, body.categoryId):
            raise HTTPException(status_code=422, detail=f"Unknown category: {body.categoryId}")
        category_id = body.categoryId
    else:
        category_id, _ = categorize(session, merchant, merchant)

    tx = Transaction(
        id=f"txn_m_{uuid.uuid4().hex[:12]}",
        account_id=body.accountId, date=body.date,
        raw_merchant=merchant, merchant=merchant,
        amount=body.amount, category_id=category_id,
        source="manual",
        notes=body.notes or None,
        tags=json.dumps(body.tags) if body.tags else None,
    )
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)


@router.patch("/{tx_id}")
def patch_transaction(
    tx_id: str, body: TransactionPatch, session: Session = Depends(get_session)
) -> dict:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    fact_touched = any(v is not None for v in (body.date, body.merchant, body.amount, body.accountId))
    if fact_touched and tx.source != "manual":
        raise HTTPException(
            status_code=422,
            detail="Bank-imported facts (date/merchant/amount/account) are immutable",
        )

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

    if body.date is not None:
        _check_date(body.date)
        tx.date = body.date
    if body.merchant is not None:
        merchant = body.merchant.strip()
        if not merchant:
            raise HTTPException(status_code=422, detail="Merchant must not be empty")
        tx.merchant = merchant
        tx.raw_merchant = merchant
    if body.amount is not None:
        if body.amount == 0:
            raise HTTPException(status_code=422, detail="Amount must not be zero")
        tx.amount = body.amount
    if body.accountId is not None:
        if not session.get(Account, body.accountId):
            raise HTTPException(status_code=422, detail=f"Unknown account: {body.accountId}")
        tx.account_id = body.accountId

    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _transaction_out(tx)


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(tx_id: str, session: Session = Depends(get_session)) -> None:
    tx = session.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.source != "manual":
        raise HTTPException(status_code=422, detail="Bank-imported transactions cannot be deleted")
    session.delete(tx)
    session.commit()
```

**Caution:** `tests/test_transactions_patch.py` asserts the old 422-on-bank-facts behaviour. It must still pass — if any of its assertions checked the *pydantic* error message shape, update only the message expectations, never the 422 status expectation.

- [ ] **Step 5: Run tests**

Run: `uv run pytest tests/test_transactions_manual.py tests/test_transactions_patch.py -q` then `uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/transactions.py backend/app/schemas.py backend/tests/test_transactions_manual.py backend/tests/test_transactions_patch.py
git commit -m "feat(m4): manual transactions — create/delete + editable facts on manual rows"
```

---

### Task 5: Frontend types, seam methods, and `cash`-kind plumbing

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/data/api.ts`
- Modify: `frontend/src/lib/kpi.ts:107,181-190,219-221`, `frontend/src/pages/Investments.tsx:25-49`, `frontend/src/pages/Accounts.tsx:37`
- Test: typecheck + existing Vitest suites (pure-lib change is exercised by existing kpi tests staying green)

**Interfaces:**
- Consumes: backend endpoints from Tasks 2–4.
- Produces (for Tasks 6–10): types `TransactionSource`; `Transaction.source: TransactionSource`; `AccountKind` includes `'cash'`. Seam exports: `createCategory(b: CategoryInput)`, `updateCategory(id, b: CategoryPatchInput)`, `deleteCategory(id): Promise<CategoryDeleteResult>`, `upsertBudgetLine(categoryId, b: {monthlyCap: number; rollover: boolean})`, `deleteBudgetLine(categoryId)`, `updateBudgetConfig(b: {mode?: BudgetMode; targetSavingsRate?: number})`, `createTransaction(b: TransactionCreateInput)`, `deleteTransaction(id)`; `TransactionPatchInput` gains `date?/merchant?/amount?/accountId?`.

- [ ] **Step 1: Types**

In `frontend/src/types/index.ts`, add `'cash'` to `AccountKind` (after `'credit_card'`):

```typescript
export type AccountKind =
  | 'chequing'
  | 'savings'
  | 'credit_card'
  | 'cash'
  | 'tfsa'
  | 'rrsp'
  | 'resp'
  | 'fhsa'
  | 'dcpp'
  | 'non_registered'
  | 'crypto';
```

Add above the `Transaction` interface, and the field inside it:

```typescript
export type TransactionSource = 'bank' | 'manual';
```

```typescript
  source: TransactionSource; // 'bank': imported, facts immutable; 'manual': user-entered, fully editable
```

- [ ] **Step 2: Seam methods**

Append to `frontend/src/data/api.ts`:

```typescript
import type { Category, CategoryGroup, Bucket503020, BudgetMode } from '../types';

export interface CategoryInput {
  name: string;
  group: CategoryGroup;
  bucket503020?: Bucket503020;
  isEssential?: boolean;
}
export interface CategoryPatchInput {
  name?: string;
  group?: CategoryGroup;
  bucket503020?: Bucket503020 | ''; // '' clears
  isEssential?: boolean;
}
export interface CategoryDeleteResult {
  deleted: boolean;
  transactionsReassigned: number;
  rulesDeleted: number;
  budgetLineDeleted: boolean;
}

export const createCategory = (b: CategoryInput) => send<Category>('POST', '/api/categories', b);
export const updateCategory = (id: string, b: CategoryPatchInput) =>
  send<Category>('PATCH', `/api/categories/${id}`, b);
export const deleteCategory = (id: string) =>
  send<CategoryDeleteResult>('DELETE', `/api/categories/${id}`);

export interface BudgetLineWire { categoryId: string; monthlyCap: number; rollover: boolean }

export const upsertBudgetLine = (categoryId: string, b: { monthlyCap: number; rollover: boolean }) =>
  send<BudgetLineWire>('PUT', `/api/budget/lines/${categoryId}`, b);
export const deleteBudgetLine = (categoryId: string) =>
  send<void>('DELETE', `/api/budget/lines/${categoryId}`);
export const updateBudgetConfig = (b: { mode?: BudgetMode; targetSavingsRate?: number }) =>
  send<{ mode: BudgetMode; targetSavingsRate?: number }>('PATCH', '/api/budget/config', b);

export interface TransactionCreateInput {
  accountId: string;
  date: string;
  merchant: string;
  amount: number;
  categoryId?: string; // omitted -> server auto-categorizes
  notes?: string;
  tags?: string[];
}

export const createTransaction = (b: TransactionCreateInput) =>
  send<Transaction>('POST', '/api/transactions', b);
export const deleteTransaction = (id: string) => send<void>('DELETE', `/api/transactions/${id}`);
```

Extend `TransactionPatchInput` in the same file:

```typescript
export interface TransactionPatchInput {
  categoryId?: string;
  isTransfer?: boolean;
  isDuplicate?: boolean;
  notes?: string;   // '' clears
  tags?: string[];  // [] clears
  // manual rows only — 422 on bank rows:
  date?: string;
  merchant?: string;
  amount?: number;
  accountId?: string;
}
```

- [ ] **Step 3: `cash`-kind plumbing (exhaustive Records must stay total)**

`frontend/src/lib/kpi.ts`:
- Line 107: `const cashKinds: Account['kind'][] = ['chequing', 'savings', 'cash'];`
- KIND_ORDER (line 181): insert `'cash'` after `'savings'`.
- KIND_LABELS (line 185): add `cash: 'Cash',` after `savings: 'Savings',`.
- Line 220: `fixtures.accounts.filter((a) => a.kind === 'chequing' || a.kind === 'savings' || a.kind === 'cash').map((a) => a.id),`

`frontend/src/pages/Investments.tsx`:
- KIND_COLORS: add `cash: '#475569',`
- KIND_LABEL: add `cash: 'Cash',`

`frontend/src/pages/Accounts.tsx:37`:

```typescript
    if (acc.kind === 'chequing' || acc.kind === 'savings' || acc.kind === 'cash') groups.cash.push(acc);
```

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npm run typecheck` then `npx vitest run`
Expected: clean; all existing tests pass (test fixtures in `store/__tests__` build `Transaction` objects via `as unknown as Fixtures`, so the new required `source` field does not break them).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/data/api.ts frontend/src/lib/kpi.ts frontend/src/pages/Investments.tsx frontend/src/pages/Accounts.tsx
git commit -m "feat(m4): frontend types + seam methods for categories/budget/manual-tx, cash kind"
```

---

### Task 6: Toast slice, ToastHost, store actions + retrofit

**Files:**
- Modify: `frontend/src/store/useAppStore.ts`
- Create: `frontend/src/components/shared/ToastHost.tsx`
- Modify: `frontend/src/components/layout/Shell.tsx` (mount ToastHost)
- Test: `frontend/src/store/__tests__/useAppStore.m4.test.ts` (create)

**Interfaces:**
- Consumes: seam methods from Task 5.
- Produces (used by Tasks 7–10): store state `toasts: Toast[]` (`{id: string; message: string}`), `pushToast(message: string)`, `dismissToast(id: string)`. Actions: `addCategory(b: CategoryInput)`, `editCategory(id, b: CategoryPatchInput)`, `removeCategory(id): Promise<CategoryDeleteResult>` (all throw on failure); `saveBudgetLine(categoryId, b)`, `removeBudgetLine(categoryId)`, `removeTransaction(id)` (toast, never throw); `addTransaction(b: TransactionCreateInput)` (throws); `setBudgetMode` persists via `updateBudgetConfig`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/store/__tests__/useAppStore.m4.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  updateTransaction: vi.fn().mockResolvedValue({}),
  createRule: vi.fn(), listRules: vi.fn().mockResolvedValue([]),
  createCategory: vi.fn().mockResolvedValue({ id: 'pets', name: 'Pets', group: 'family' }),
  updateCategory: vi.fn().mockResolvedValue({}),
  deleteCategory: vi.fn().mockResolvedValue({
    deleted: true, transactionsReassigned: 3, rulesDeleted: 1, budgetLineDeleted: true,
  }),
  upsertBudgetLine: vi.fn().mockResolvedValue({}),
  deleteBudgetLine: vi.fn().mockResolvedValue(undefined),
  updateBudgetConfig: vi.fn().mockResolvedValue({ mode: 'zero_based' }),
  createTransaction: vi.fn().mockResolvedValue({ id: 'txn_m_1' }),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '../../data/api';
import { useAppStore } from '../useAppStore';
import type { Fixtures } from '../../types';

const fixtures = {
  transactions: [
    { id: 't1', date: '2026-01-05', accountId: 'chq', rawMerchant: 'X', merchant: 'X', amount: -1, categoryId: 'groceries', source: 'manual' },
  ],
  categories: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] },
  craLimits: {}, meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  useAppStore.setState({ fixtures, loaded: true, rules: [], toasts: [], budgetMode: 'envelope' });
});

describe('toasts', () => {
  it('pushToast appends and dismissToast removes', () => {
    useAppStore.getState().pushToast('boom');
    const t = useAppStore.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0]!.message).toBe('boom');
    useAppStore.getState().dismissToast(t[0]!.id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('reclassifyTransaction toasts and refetches on failure', async () => {
    vi.mocked(api.updateTransaction).mockRejectedValueOnce(new Error('500'));
    await useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(useAppStore.getState().toasts[0]!.message).toContain("Couldn't save");
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('setBudgetMode persists via config PATCH and reverts + toasts on failure', async () => {
    useAppStore.getState().setBudgetMode('zero_based');
    expect(api.updateBudgetConfig).toHaveBeenCalledWith({ mode: 'zero_based' });

    vi.mocked(api.updateBudgetConfig).mockRejectedValueOnce(new Error('500'));
    useAppStore.getState().setBudgetMode('fifty_thirty_twenty');
    await vi.waitFor(() => expect(useAppStore.getState().budgetMode).toBe('zero_based'));
    expect(useAppStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('m4 actions', () => {
  it('addCategory posts then refetches; failures propagate', async () => {
    await useAppStore.getState().addCategory({ name: 'Pets', group: 'family' });
    expect(api.createCategory).toHaveBeenCalled();
    expect(api.loadFixtures).toHaveBeenCalled();
    vi.mocked(api.createCategory).mockRejectedValueOnce(new Error('409'));
    await expect(useAppStore.getState().addCategory({ name: 'Pets', group: 'family' })).rejects.toThrow();
  });

  it('removeCategory returns the cascade counts', async () => {
    const r = await useAppStore.getState().removeCategory('groceries');
    expect(r.transactionsReassigned).toBe(3);
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('saveBudgetLine toasts instead of throwing on failure', async () => {
    vi.mocked(api.upsertBudgetLine).mockRejectedValueOnce(new Error('500'));
    await useAppStore.getState().saveBudgetLine('groceries', { monthlyCap: 100, rollover: false });
    expect(useAppStore.getState().toasts).toHaveLength(1);
  });

  it('removeTransaction removes optimistically and calls DELETE', async () => {
    await useAppStore.getState().removeTransaction('t1');
    expect(api.deleteTransaction).toHaveBeenCalledWith('t1');
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('addTransaction posts and refetches; failures propagate', async () => {
    await useAppStore.getState().addTransaction({ accountId: 'cash_wallet', date: '2026-07-10', merchant: 'M', amount: -5 });
    expect(api.createTransaction).toHaveBeenCalled();
    vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error('422'));
    await expect(
      useAppStore.getState().addTransaction({ accountId: 'cash_wallet', date: '2026-07-10', merchant: 'M', amount: -5 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/__tests__/useAppStore.m4.test.ts`
Expected: FAIL — `pushToast is not a function`.

- [ ] **Step 3: Implement the store changes**

In `frontend/src/store/useAppStore.ts`:

Add to the `AppState` interface:

```typescript
  toasts: { id: string; message: string }[];
  pushToast: (message: string) => void;
  dismissToast: (id: string) => void;
  addCategory: (b: import('../data/api').CategoryInput) => Promise<void>;
  editCategory: (id: string, b: import('../data/api').CategoryPatchInput) => Promise<void>;
  removeCategory: (id: string) => Promise<import('../data/api').CategoryDeleteResult>;
  saveBudgetLine: (categoryId: string, b: { monthlyCap: number; rollover: boolean }) => Promise<void>;
  removeBudgetLine: (categoryId: string) => Promise<void>;
  addTransaction: (b: import('../data/api').TransactionCreateInput) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
```

Add initial state `toasts: []` and, in the implementation object:

```typescript
  toasts: [],
  pushToast: (message) =>
    set((s) => ({ toasts: [...s.toasts, { id: `toast_${Date.now()}_${s.toasts.length}`, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
```

Replace `setBudgetMode` (persist + revert-and-toast on failure):

```typescript
  setBudgetMode: (mode) => {
    const prev = get().budgetMode;
    set({ budgetMode: mode });
    void api.updateBudgetConfig({ mode }).catch(() => {
      set({ budgetMode: prev });
      get().pushToast("Couldn't save budget mode — changes reverted");
    });
  },
```

Retrofit `reclassifyTransaction` — replace the `try/finally` with:

```typescript
    try {
      await api.updateTransaction(txId, { categoryId });
    } catch {
      get().pushToast("Couldn't save category — changes reverted");
    } finally {
      await get().refetch(); // success: confirm; failure: revert to server truth
    }
```

Retrofit `editTransaction`:

```typescript
  editTransaction: async (id, b) => {
    try {
      await api.updateTransaction(id, b);
    } catch {
      get().pushToast("Couldn't save transaction — changes reverted");
    }
    await get().refetch();
  },
```

Add the new actions (throwing ones plain, fire-and-forget ones toast-guarded):

```typescript
  addCategory: async (b) => { await api.createCategory(b); await get().refetch(); },
  editCategory: async (id, b) => { await api.updateCategory(id, b); await get().refetch(); },
  removeCategory: async (id) => {
    const result = await api.deleteCategory(id);
    await get().refetch();
    await get().loadRules(); // cascade may have deleted rules
    return result;
  },
  saveBudgetLine: async (categoryId, b) => {
    try {
      await api.upsertBudgetLine(categoryId, b);
    } catch {
      get().pushToast("Couldn't save budget line — changes reverted");
    }
    await get().refetch();
  },
  removeBudgetLine: async (categoryId) => {
    try {
      await api.deleteBudgetLine(categoryId);
    } catch {
      get().pushToast("Couldn't save budget line — changes reverted");
    }
    await get().refetch();
  },
  addTransaction: async (b) => { await api.createTransaction(b); await get().refetch(); },
  removeTransaction: async (id) => {
    const f = get().fixtures;
    if (f) set({ fixtures: { ...f, transactions: f.transactions.filter((t) => t.id !== id) } });
    try {
      await api.deleteTransaction(id);
    } catch {
      get().pushToast("Couldn't save deletion — changes reverted");
    }
    await get().refetch();
  },
```

- [ ] **Step 4: ToastHost component**

Create `frontend/src/components/shared/ToastHost.tsx`:

```tsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

// Global error-toast stack (bottom-right). Oldest toast auto-dismisses after 6s.
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => dismiss(toasts[0]!.id), 6000);
    return () => clearTimeout(timer);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 bg-bg-elev border border-down/60 text-ink text-sm rounded-lg px-4 py-2.5 shadow-lg"
        >
          <span>{t.message}</span>
          <button
            className="text-ink-dim hover:text-ink"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
```

Mount it in `frontend/src/components/layout/Shell.tsx`: import `ToastHost` and render `<ToastHost />` as the last child of the root layout element (read the file; place it just inside the outermost wrapper so it overlays every page).

- [ ] **Step 5: Run tests**

Run: `npx vitest run` and `npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/useAppStore.ts frontend/src/components/shared/ToastHost.tsx frontend/src/components/layout/Shell.tsx frontend/src/store/__tests__/useAppStore.m4.test.ts
git commit -m "feat(m4): toast slice + host, store actions, fire-and-forget retrofit"
```

---

### Task 7: Settings — Categories card (CRUD UI)

**Files:**
- Modify: `frontend/src/pages/Settings.tsx` (add `CategoriesSection`, replace the read-only chips card at lines 477-485)

**Interfaces:**
- Consumes: store `addCategory` / `editCategory` / `removeCategory` (Task 6), `ConfirmDeleteModal` (existing: props `open, title, description, onCancel, onConfirm`, optional `confirmLabel/confirmPhrase/onForceConfirm`), `Card`, `Button`.
- Produces: `CategoriesSection` component rendered inside the existing Settings page.

- [ ] **Step 1: Implement the component**

Add to `frontend/src/pages/Settings.tsx` (above `Settings`, after `RulesSection`). Imports needed at top: `CategoryGroup`, `Bucket503020` types.

```tsx
const CATEGORY_GROUPS: CategoryGroup[] = ['essentials', 'lifestyle', 'family', 'financial', 'transfers', 'income'];
const BUCKETS: Bucket503020[] = ['needs', 'wants', 'savings'];

function CategoriesSection() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const addCategory = useAppStore((s) => s.addCategory);
  const editCategory = useAppStore((s) => s.editCategory);
  const removeCategory = useAppStore((s) => s.removeCategory);

  const inputClass = 'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
  const selectClass = 'w-full bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand';

  const empty = { name: '', group: 'lifestyle' as CategoryGroup, bucket: '' as Bucket503020 | '', essential: false };
  const [form, setForm] = useState(empty);
  const [draft, setDraft] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [lastCascade, setLastCascade] = useState('');
  const pendingCategory = fixtures.categories.find((c) => c.id === pendingDelete) ?? null;

  const sorted = [...fixtures.categories].sort(
    (a, b) => CATEGORY_GROUPS.indexOf(a.group) - CATEGORY_GROUPS.indexOf(b.group) || a.name.localeCompare(b.name),
  );

  async function submit() {
    setError('');
    try {
      await addCategory({
        name: form.name, group: form.group,
        bucket503020: form.bucket || undefined,
        isEssential: form.essential || undefined,
      });
      setForm(empty);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveEdit(id: string) {
    setError('');
    try {
      await editCategory(id, {
        name: draft.name, group: draft.group,
        bucket503020: draft.bucket, isEssential: draft.essential,
      });
      setEditingId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <table className="w-full text-sm mb-2 table-fixed">
        <thead>
          <tr className="text-left text-xs text-ink-dim uppercase tracking-wider">
            <th className="py-1 pr-3 w-[30%]">Name</th>
            <th className="py-1 pr-3 w-[20%]">Group</th>
            <th className="py-1 pr-3 w-[18%]">50/30/20</th>
            <th className="py-1 pr-3 w-[14%]">Essential</th>
            <th className="w-[18%]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((c) =>
            c.id === 'unclassified' ? (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink">{c.name}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.group}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.bucket503020 ?? '—'}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.isEssential ? 'yes' : '—'}</td>
                <td className="text-right text-xs text-ink-dim">protected</td>
              </tr>
            ) : editingId === c.id ? (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </td>
                <td className="py-1.5 pr-3">
                  <select className={selectClass} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as CategoryGroup })}>
                    {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td className="py-1.5 pr-3">
                  <select className={selectClass} value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value as Bucket503020 | '' })}>
                    <option value="">—</option>
                    {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </td>
                <td className="py-1.5 pr-3">
                  <input type="checkbox" className="accent-brand" checked={draft.essential} onChange={(e) => setDraft({ ...draft, essential: e.target.checked })} />
                </td>
                <td className="text-right whitespace-nowrap">
                  <Button onClick={() => saveEdit(c.id)} disabled={!draft.name.trim()}>Save</Button>
                  <button className="text-ink-muted hover:text-ink ml-2" onClick={() => { setEditingId(null); setError(''); }}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink">{c.name}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.group}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.bucket503020 ?? '—'}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{c.isEssential ? 'yes' : '—'}</td>
                <td className="text-right whitespace-nowrap">
                  <button
                    className="text-ink-muted hover:text-ink"
                    onClick={() => {
                      setDraft({ name: c.name, group: c.group, bucket: c.bucket503020 ?? '', essential: c.isEssential ?? false });
                      setEditingId(c.id);
                      setError('');
                    }}
                  >
                    Edit
                  </button>
                  <button className="text-down ml-2" onClick={() => setPendingDelete(c.id)}>Delete</button>
                </td>
              </tr>
            ),
          )}
          <tr className="border-t border-line">
            <td className="pt-2 pr-3">
              <input className={inputClass} placeholder="New category" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </td>
            <td className="pt-2 pr-3">
              <select className={selectClass} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value as CategoryGroup })}>
                {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </td>
            <td className="pt-2 pr-3">
              <select className={selectClass} value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value as Bucket503020 | '' })}>
                <option value="">—</option>
                {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </td>
            <td className="pt-2 pr-3">
              <input type="checkbox" className="accent-brand" checked={form.essential} onChange={(e) => setForm({ ...form, essential: e.target.checked })} />
            </td>
            <td className="pt-2 text-right">
              <Button onClick={() => void submit()} disabled={!form.name.trim()}>Add category</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {error && <p className="text-down text-sm mt-2">{error}</p>}
      {lastCascade && <p className="text-xs text-ink-dim mt-2">{lastCascade}</p>}
      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={`Delete ${pendingCategory?.name ?? 'this category'}?`}
        description="Its transactions move to “unclassified”; its budget line and any rules pointing at it are deleted."
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            const r = await removeCategory(pendingDelete);
            setLastCascade(
              `Deleted: ${r.transactionsReassigned} transactions → unclassified, ` +
              `${r.rulesDeleted} rule${r.rulesDeleted === 1 ? '' : 's'} deleted` +
              `${r.budgetLineDeleted ? ', budget line removed' : ''}.`,
            );
          } catch (e) {
            setError((e as Error).message);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the page**

Replace the read-only chips card in `Settings` (`<Card title="Categories" …>` block, lines 477-485) with:

```tsx
      <Card title="Categories" subtitle={`${fixtures.categories.length} categories — used by transactions, budgets, and rules`}>
        <CategoriesSection />
      </Card>
```

Add `CategoryGroup` and `Bucket503020` to the type imports at the top of the file.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` and `npx vitest run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat(m4): Settings categories card — add/edit/delete with cascade summary"
```

---

### Task 8: Budgets page — inline caps, persisted rollover, add/remove lines

**Files:**
- Modify: `frontend/src/pages/Budgets.tsx`

**Interfaces:**
- Consumes: store `saveBudgetLine(categoryId, {monthlyCap, rollover})`, `removeBudgetLine(categoryId)` (Task 6). Mode persistence needs no page change — `setBudgetMode` persists since Task 6.
- Produces: editable Budgets table.

- [ ] **Step 1: Remove the fake rollover state and wire the store**

In `frontend/src/pages/Budgets.tsx`:
- Delete the `localRollover` state (lines 37-39).
- Add store selectors after `setBudgetMode`:

```typescript
  const saveBudgetLine = useAppStore((s) => s.saveBudgetLine);
  const removeBudgetLine = useAppStore((s) => s.removeBudgetLine);
```

- Build a line lookup after `catById`:

```typescript
  const lineByCat = new Map(fixtures.budget.lines.map((l) => [l.categoryId, l]));
```

- [ ] **Step 2: Editable cap cell**

Add a `CapCell` component at the bottom of the file:

```tsx
function CapCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        className="num text-ink-muted hover:text-ink underline decoration-dotted underline-offset-4"
        onClick={() => { setDraft(String(value)); setEditing(true); }}
      >
        {cad(value, true)}
      </button>
    );
  }
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v) && v >= 0 && v !== value) onCommit(v);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-24 bg-bg-elev border border-line rounded-md px-2 py-0.5 text-sm text-ink text-right num focus:outline-none focus:border-brand"
    />
  );
}
```

- [ ] **Step 3: Rewire the table row**

In the categories table body (`status.map((s) => …)`), replace the Budgeted cell:

```tsx
                  <td className="py-2 text-right num text-ink-muted">
                    <CapCell
                      value={s.budgeted}
                      onCommit={(v) =>
                        void saveBudgetLine(s.categoryId, {
                          monthlyCap: v,
                          rollover: lineByCat.get(s.categoryId)?.rollover ?? false,
                        })
                      }
                    />
                  </td>
```

Replace the rollover checkbox (envelope mode cell):

```tsx
                  {budgetMode === 'envelope' && (
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={lineByCat.get(s.categoryId)?.rollover ?? false}
                        onChange={(e) =>
                          void saveBudgetLine(s.categoryId, {
                            monthlyCap: lineByCat.get(s.categoryId)?.monthlyCap ?? s.budgeted,
                            rollover: e.target.checked,
                          })
                        }
                        className="accent-brand"
                      />
                    </td>
                  )}
```

Add a remove-line button as a new final cell in every row (and an empty `<th className="py-2 w-8"></th>` in the header):

```tsx
                  <td className="py-2 text-right">
                    <button
                      className="text-ink-dim hover:text-down"
                      title="Remove from budget"
                      onClick={() => void removeBudgetLine(s.categoryId)}
                    >
                      ✕
                    </button>
                  </td>
```

- [ ] **Step 4: "Add category to budget" row**

Below the table (inside the same Card, after `</table>`), add:

```tsx
          <AddBudgetLine
            categories={fixtures.categories.filter(
              (c) => !lineByCat.has(c.id) && c.id !== 'unclassified' && c.group !== 'income',
            )}
            onAdd={(categoryId, cap) => void saveBudgetLine(categoryId, { monthlyCap: cap, rollover: false })}
          />
```

And the component at the bottom of the file:

```tsx
function AddBudgetLine({
  categories,
  onAdd,
}: {
  categories: { id: string; name: string }[];
  onAdd: (categoryId: string, cap: number) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [cap, setCap] = useState('');
  if (categories.length === 0) return null;
  const capNum = Number(cap);
  const valid = categoryId !== '' && cap !== '' && Number.isFinite(capNum) && capNum >= 0;
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line text-sm">
      <span className="text-xs text-ink-dim">Add category to budget</span>
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
      >
        <option value="">Choose…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input
        value={cap}
        onChange={(e) => setCap(e.target.value)}
        placeholder="Monthly cap"
        className="w-28 bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink text-right num placeholder:text-ink-dim focus:outline-none focus:border-brand"
      />
      <Button
        disabled={!valid}
        onClick={() => { onAdd(categoryId, capNum); setCategoryId(''); setCap(''); }}
      >
        Add
      </Button>
    </div>
  );
}
```

Add the `Button` import at the top of the file (`import { Button } from '../components/ui/Button';`).

**Note:** `budgetStatus` derives `budgeted` from `fixtures.budget.lines`; the store's `refetch()` after every `saveBudgetLine`/`removeBudgetLine` keeps the table in sync — no page-level state needed.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` and `npx vitest run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Budgets.tsx
git commit -m "feat(m4): Budgets page — inline cap editing, persisted rollover, add/remove lines"
```

---

### Task 9: Transactions page — cash entry, manual badge, manual editor + delete

**Files:**
- Modify: `frontend/src/pages/Transactions.tsx`

**Interfaces:**
- Consumes: store `addTransaction` (throws — form shows inline error), `removeTransaction`, `editTransaction` (accepts manual-fact fields since Task 5/6); `Badge` from `components/ui/Badge`.
- Produces: "Add transaction" button + form; `manual` badge; extended `TxEditor`.

- [ ] **Step 1: Add-transaction form**

In `frontend/src/pages/Transactions.tsx`, add imports: `Badge` from `'../components/ui/Badge'`. Add store selectors in `Transactions`:

```typescript
  const addTransaction = useAppStore((s) => s.addTransaction);
  const removeTransaction = useAppStore((s) => s.removeTransaction);
```

Add state `const [adding, setAdding] = useState(false);` and an "Add transaction" button inside the first Card's flex row, right before the Reset button:

```tsx
            <Button onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add transaction'}</Button>
```

Directly under the first `<Card>…</Card>` (between the two cards), render:

```tsx
      {adding && (
        <Card title="Add transaction" subtitle="cash or missed entries — fully editable later">
          <AddTransactionForm
            accounts={fixtures.accounts.filter((a) =>
              ['cash', 'chequing', 'savings', 'credit_card'].includes(a.kind),
            )}
            categories={fixtures.categories}
            onSubmit={async (b) => {
              await addTransaction(b);
              setAdding(false);
            }}
          />
        </Card>
      )}
```

Add the component at the bottom of the file:

```tsx
function AddTransactionForm({
  accounts,
  categories,
  onSubmit,
}: {
  accounts: { id: string; name: string; kind: string }[];
  categories: { id: string; name: string }[];
  onSubmit: (b: import('../data/api').TransactionCreateInput) => Promise<void>;
}) {
  const cashId = accounts.find((a) => a.kind === 'cash')?.id ?? accounts[0]?.id ?? '';
  const [accountId, setAccountId] = useState(cashId);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState(''); // '' = Auto
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const inputClass = 'bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
  const amountNum = Number(amount);
  const valid = accountId && date && merchant.trim() && amount !== '' && Number.isFinite(amountNum) && amountNum > 0;

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Account
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Merchant
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Farmers' market" className={`${inputClass} w-52`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Amount
        <div className="flex items-center gap-1">
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'expense' | 'income')} className={inputClass}>
            <option value="expense">expense</option>
            <option value="income">income</option>
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputClass} w-24 text-right num`} />
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Category
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          <option value="">Auto</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} w-40`} />
      </label>
      <Button
        disabled={!valid || busy}
        onClick={async () => {
          setError('');
          setBusy(true);
          try {
            await onSubmit({
              accountId, date, merchant: merchant.trim(),
              amount: direction === 'expense' ? -Math.abs(amountNum) : Math.abs(amountNum),
              categoryId: categoryId || undefined,
              notes: notes.trim() || undefined,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Adding…' : 'Add'}
      </Button>
      {error && <p className="text-down text-sm w-full">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Manual badge**

In the merchant cell of the table row (next to `{t.merchant}`):

```tsx
                      <div className="flex items-center gap-2">
                        {t.merchant}
                        {t.source === 'manual' && <Badge tone="info">manual</Badge>}
                      </div>
```

- [ ] **Step 3: Extend TxEditor for manual rows**

Replace `TxEditor` with a version that adds fact fields + delete for manual rows. Pass the extra props at the call site:

```tsx
                        <TxEditor
                          tx={t}
                          accounts={fixtures.accounts.filter((a) =>
                            ['cash', 'chequing', 'savings', 'credit_card'].includes(a.kind),
                          )}
                          onSave={async (patch) => {
                            await editTransaction(t.id, patch);
                            setExpandedId(null);
                          }}
                          onDelete={
                            t.source === 'manual'
                              ? async () => {
                                  await removeTransaction(t.id);
                                  setExpandedId(null);
                                }
                              : undefined
                          }
                        />
```

New `TxEditor`:

```tsx
function TxEditor({
  tx,
  accounts,
  onSave,
  onDelete,
}: {
  tx: import('../types').Transaction;
  accounts: { id: string; name: string }[];
  onSave: (patch: import('../data/api').TransactionPatchInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const manual = tx.source === 'manual';
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [tags, setTags] = useState((tx.tags ?? []).join(', '));
  const [isTransfer, setIsTransfer] = useState(tx.isTransfer ?? false);
  const [isDuplicate, setIsDuplicate] = useState(tx.isDuplicate ?? false);
  const [date, setDate] = useState(tx.date);
  const [merchant, setMerchant] = useState(tx.merchant);
  const [amount, setAmount] = useState(String(tx.amount));
  const [accountId, setAccountId] = useState(tx.accountId);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const inputClass = 'bg-bg-elev border border-line rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand';
  const amountNum = Number(amount);
  const factsValid = !manual || (date.length === 10 && merchant.trim() !== '' && Number.isFinite(amountNum) && amountNum !== 0);

  return (
    <div className="space-y-3">
      {manual && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-ink-muted">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Merchant
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={`${inputClass} w-48`} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} w-24 text-right num`} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 text-ink-muted">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} w-56`} />
        </label>
        <label className="flex items-center gap-2 text-ink-muted">
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" className={`${inputClass} w-48`} />
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
          disabled={busy || !factsValid}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                notes,
                tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
                isTransfer,
                isDuplicate,
                ...(manual
                  ? { date, merchant: merchant.trim(), amount: amountNum, accountId }
                  : {}),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {onDelete &&
          (confirmingDelete ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-down">Delete this entry?</span>
              <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>
                Yes, delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </span>
          ) : (
            <button className="text-down text-xs" onClick={() => setConfirmingDelete(true)}>Delete</button>
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` and `npx vitest run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions.tsx
git commit -m "feat(m4): Transactions page — cash entry form, manual badge, manual-row editor + delete"
```

---

### Task 10: Rules card — inline keyword editing (frontend only)

**Files:**
- Modify: `frontend/src/pages/Settings.tsx` (RulesSection, lines 380-407)

**Interfaces:**
- Consumes: existing store `editRule(id, {keyword})` (throws; backend `PUT /api/rules/{id}` already validates + 409s).
- Produces: click-to-edit keyword cell with inline error.

- [ ] **Step 1: Implement**

In `RulesSection`, add state:

```typescript
  const [editingKeywordId, setEditingKeywordId] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState('');
```

Replace the keyword cell (`<td className="py-2 text-ink">{r.keyword}</td>`) with:

```tsx
                <td className="py-2 text-ink">
                  {editingKeywordId === r.id ? (
                    <input
                      autoFocus
                      value={keywordDraft}
                      onChange={(e) => setKeywordDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') setEditingKeywordId(null);
                        if (e.key === 'Enter' && keywordDraft.trim()) {
                          setError('');
                          try {
                            await editRule(r.id, { keyword: keywordDraft.trim() });
                            setEditingKeywordId(null);
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }
                      }}
                      onBlur={() => setEditingKeywordId(null)}
                      className="bg-bg-elev border border-line rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand w-40"
                    />
                  ) : (
                    <button
                      className="hover:text-ink underline decoration-dotted underline-offset-4"
                      onClick={() => { setKeywordDraft(r.keyword); setEditingKeywordId(r.id); setError(''); }}
                    >
                      {r.keyword}
                    </button>
                  )}
                </td>
```

**Note:** commit happens on Enter, not blur — blur cancels, so an errored 409 edit (input stays open, error shown below the form) can be retried or Escape'd.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` and `npx vitest run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat(m4): inline rule keyword editing in the Settings rules card"
```

---

### Task 11: Docs + full sweep

**Files:**
- Modify: `CLAUDE.md` (Current state paragraph + known gaps), `.claude/skills/verify/SKILL.md` (only if a documented command/flow became wrong)

**Interfaces:** none.

- [ ] **Step 1: Update CLAUDE.md**

In the "What this is" section, replace the **Current state** paragraph with one covering M4 (keep M3 sentences that still hold, add): categories CRUD (`/api/categories`, Settings card, delete cascades to `unclassified`), budgets editable (`/api/budget`, inline on Budgets page, mode persisted), manual cash transactions (`POST/DELETE /api/transactions`, Cash wallet account, fully editable facts on `source='manual'` rows), failed optimistic writes toast + revert, spec pointer `docs/superpowers/specs/2026-07-17-m4-editable-categories-budgets-design.md`.

In "Known gaps", remove "Categories & budgets are in the DB but not yet editable (candidate M4)."

- [ ] **Step 2: Full verification sweep**

```bash
cd backend && uv run pytest -q          # expect: all pass
cd ../frontend && npx vitest run        # expect: all pass
npm run build                           # expect: tsc + vite build clean
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(m4): CLAUDE.md current-state refresh for editable categories/budgets/cash entry"
```

---

## Post-merge note (for the human)

After this branch merges: **delete `backend/deeppocket.db` and re-run `uv run seed.py`** — `Transaction.source`, the merchant index, and the `cash_wallet` account require a rebuild (seed never alters existing tables).
