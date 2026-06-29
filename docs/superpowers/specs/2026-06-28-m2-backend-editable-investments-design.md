# Milestone 2 — Backend + Editable Investment Data

- **Date:** 2026-06-28
- **Status:** Approved (design), pending spec review
- **Branch:** `m2-backend-editable-investments`
- **Supersedes/Extends:** Milestone 1 (mock generator + read-only React frontend)

## 1. Context & Problem

DeepPocket M1 is a polished but **read-only mock prototype**: a Python generator emits
`fixtures.json`, the React app imports it statically through the single data seam
`frontend/src/data/api.ts`, and every screen derives numbers via pure functions in
`lib/kpi.ts` / `lib/canadian.ts`. There is **no backend and no persistence** — any edit
is lost on reload.

The owner wants to start using **real investment data** (a periodic balance CSV) and to
**manage that data from the UI**: import the CSV, add/fix individual rows, add the people
and accounts involved, update a value as of a date, and track **manual contributions**
against CRA limits for RRSP/TFSA/RESP (with RESP driving CESG).

This milestone stands up the planned backend and makes the investment domain fully
editable and persistent, while keeping all 10 existing screens working.

## 2. Goals

1. Persistent backend: **FastAPI + SQLModel + SQLite**, served locally.
2. Frontend reads/writes through the existing seam — `api.ts` swaps static JSON for HTTP;
   screens otherwise unchanged. Prove the "one-file seam" claim from M1.
3. **Import real investment CSV** (`date, person, institution, account_type, amount`),
   auto-creating any missing person/account, upserting snapshots by `(account, date)`.
4. **Editable investment snapshots**: add an individual line, edit/fix an existing line,
   delete a line — same upsert semantics as import.
5. **Manage people & accounts** from the Settings page (add/edit/remove).
6. **Manual contributions** for RRSP/TFSA/RESP (FHSA supported by the same machinery),
   tracked against the 2025 CRA limits already in `lib/canadian.ts`; **RESP contributions
   derive CESG automatically** (20%, capped $500/yr/child and $7,200 lifetime).
7. Introduce automated tests (pytest backend, Vitest frontend) — closing the M1 "no tests"
   gap for the new surfaces.

## 3. Non-Goals (this milestone)

- Authentication / multi-user login. Local-only, single household.
- Making transactions / budgets / categories / rules editable — they stay **seeded
  read-only** for now. (`reclassifyTransaction` remains the existing in-memory client action.)
- A contribution **CSV** importer (contributions are manual entry this cut; the CSV is
  snapshots only).
- PDF export, mobile-first rework, ML categorization (still deferred).
- Cloud/hosted deployment. Dev runs `uvicorn` + `vite` locally.

## 4. Architecture

```
backend/ (NEW)              FastAPI + SQLModel + SQLite (deeppocket.db)
  app/main.py               FastAPI app, CORS for the Vite dev origin
  app/models.py             SQLModel tables (see §5)
  app/schemas.py            request/response models
  app/db.py                 engine/session
  app/routers/
    data.py                 GET /api/data  -> full fixtures-shaped payload
    people.py               CRUD /api/people
    accounts.py             CRUD /api/accounts
    snapshots.py            CRUD + upsert /api/snapshots
    contributions.py        CRUD /api/contributions
    imports.py              POST /api/import/investments-csv
  app/services/
    fixtures.py             assemble the fixtures-shaped payload from tables
    cesg.py                 derive CESG grants from RESP contributions
    csv_import.py           parse + upsert investment CSV
  seed.py                   load mock fixtures.json into the DB (idempotent)
  requirements.txt          fastapi, uvicorn, sqlmodel, python-multipart
  tests/                    pytest

frontend/src/data/api.ts    THE SEAM
  loadFixtures()            static import  ->  fetch(`${BASE}/api/data`)
  + write methods:          createPerson/updatePerson/deletePerson,
                            createAccount/updateAccount/deleteAccount,
                            upsertSnapshot/updateSnapshot/deleteSnapshot,
                            createContribution/updateContribution/deleteContribution,
                            importInvestmentsCsv(file)
frontend/src/store/useAppStore.ts
  async write actions; after a mutation, refetch GET /api/data and replace fixtures
  (data volume is small; optimistic UI is a later optimization)
frontend/vite.config.ts
  server.proxy '/api' -> http://localhost:8000   (configurable via VITE_API_BASE_URL)
```

**Why this shape.** Serving the same fixtures payload from `GET /api/data` means the
existing pure-function pipeline (`kpi.ts`, `canadian.ts`) and all 10 screens keep working
with zero changes — the swap is genuinely confined to `api.ts` + the store. Mutations are
ordinary REST resources; the store refetches the consolidated payload after each write so
every screen stays consistent (the same single-source-of-truth property M1 had in memory).

## 5. Data Model

Editable tables are **bold**. CESG is **derived**, not stored-and-hand-edited.

- **`person`**: `id` (pk), `name` (unique, case-insensitive match on import), `role`
  (`adult` | `child`), `birth_year` (nullable; required for RESP/CESG child pacing).
- **`account`**: `id` (pk), `person_id` (fk → owner), `institution` (free text),
  `account_type` (**free text** — supports `dccp2`, `crypto`, etc.), `kind`
  (categorization for display/room logic: registered `tfsa|rrsp|resp|fhsa` vs
  `crypto|dcpp|non_registered|other`). `kind` is **inferred** from `account_type` via a
  normalization map (`dccp2`/`dcpp`→`dcpp`, `tfsa`→`tfsa`, … ; unknown→`other`) and is
  **user-overridable** in the account form, since only `tfsa|rrsp|resp|fhsa` drive
  contribution-room/CESG logic. `name` (display, default
  `"{institution} {account_type}"`), `is_liability` (default false),
  `beneficiary_person_id` (nullable, RESP). **Natural key:** `(person_id, institution,
  account_type)` — used for import dedupe/auto-create.
- **`investment_snapshot`**: `id` (pk), `account_id` (fk), `date` (ISO `YYYY-MM-DD`),
  `amount` (numeric). **Unique `(account_id, date)`** — re-entering a date overwrites.
- **`contribution`**: `id` (pk), `account_id` (fk), `person_id` (fk → contributor),
  `date`, `amount`, `kind` (`rrsp|tfsa|resp|fhsa`), `beneficiary_person_id` (nullable, RESP).
- **Seeded read-only** (from M1 generator): transactions, categories, rules, budget,
  bank/credit accounts + their ledgers, `craLimits`, `meta`.

**CESG derivation (`services/cesg.py`).** For each RESP contribution: grant = 20% of the
contribution, accumulated per child per calendar year, **capped at $500/yr** and **$7,200
lifetime**. Grants are recomputed whenever a RESP contribution is created/edited/deleted and
returned in `GET /api/data` under `cesgGrants`, so `lib/canadian.ts` reads them unchanged.

### Seeding strategy
`seed.py` loads the M1 mock `fixtures.json` so the app works out of the box. Because the
owner is switching to **real** investment data, the seeder supports:
- default: seed the full mock dataset (demo baseline);
- `--investments=empty`: seed everything **except** investment snapshots & contributions,
  so the investment domain starts clean for real entry while transactions/budgets stay
  populated.
Seeding is **idempotent** (re-running does not duplicate rows).

## 6. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/data` | Full fixtures-shaped payload (initial load + post-mutation refetch) |
| GET/POST | `/api/people` · PUT/DELETE `/api/people/{id}` | Household member CRUD |
| GET/POST | `/api/accounts` · PUT/DELETE `/api/accounts/{id}` | Account CRUD |
| GET | `/api/snapshots?account_id=` | List snapshots (for the editable grid) |
| POST | `/api/snapshots` | **Upsert** by `(account_id, date)` |
| PUT/DELETE | `/api/snapshots/{id}` | Edit/fix or delete a line |
| GET/POST | `/api/contributions` · PUT/DELETE `/api/contributions/{id}` | Contribution CRUD |
| POST | `/api/import/investments-csv` | Multipart upload → row-level summary |

**Validation/errors.** Dates accept `YYYYMMDD` and `YYYY-MM-DD`; amounts numeric; person
match is case-insensitive (`sanjay` → existing `Sanjay`); deleting a person/account with
dependent rows is blocked with a clear message (or cascades — see open questions). Import
returns `{created, updated, skipped, errors:[{row, reason}]}`.

## 7. Features (UX)

1. **CSV import** — the **Import page** (today a stub) becomes real *for investments*:
   choose a file matching `date, person, institution, account_type, amount`, see a preview
   and a post-import summary (created/updated/skipped + row errors). Auto-creates missing
   people/accounts, upserts snapshots.
2. **Investment snapshots — editable grid** (Investments page): a table of `(account, date,
   amount)` with **add line**, **inline edit/fix**, **delete**. A quick "Add / update value"
   form is the fast path. Import, form, and edited cell all hit the same upsert.
3. **People & accounts management** (Settings page): editable **Household** section (add/edit/
   remove person: name, role, birth year) and **Investment accounts** section (person,
   institution, account_type, optional RESP beneficiary).
4. **Update amount as of a date**: same upsert/edit on snapshots — new date appends to the
   account's time series (flows into Net Worth & allocation); existing date overwrites.
5. **Manual contributions** (Investments page): entry form + editable grid for RRSP/TFSA/RESP
   (FHSA available). Feeds the existing **contribution-room cards** and **per-kid CESG
   dashboard** with real numbers; RESP entries derive CESG automatically.

## 8. Testing

- **pytest (backend):** CSV parse (both date formats), upsert dedupe on `(account, date)`,
  person/account case-insensitive auto-create, CRUD happy/error paths, CESG derivation
  (20%, annual + lifetime caps), room calc vs `craLimits`, seed idempotency,
  `GET /api/data` shape parity with M1 `fixtures.json`.
- **Vitest (frontend):** `api.ts` client against a mocked fetch; store write→refetch cycle;
  `kpi.ts` net-worth/allocation recompute after a new snapshot; `canadian.ts` room/CESG from
  contributions.

## 9. Sequencing (becomes the implementation plan)

1. Backend skeleton: models, db, `seed.py`, `GET /api/data`, CORS; swap `api.ts`→fetch +
   Vite proxy. **Exit:** all 10 screens render from the backend (seam proven).
2. People + Account CRUD endpoints + Settings editing UI.
3. Investment snapshots: import endpoint + editable grid + add/update form.
4. Contributions: endpoints + entry/grid + wire room/CESG (CESG derivation).
5. Tests across all of the above + README/run docs update.

## 10. Tracked separately (GitHub project — "key gaps")

Not built here, but added to the board with rationale:
- Wire the **dead rules engine** (`lib/categorize.ts` is never imported; the 64 fixture
  rules are unused by the UI).
- **Test harness** baseline (Vitest + pytest) — partially delivered by this milestone.
- **`non_registered` net-worth fix** (omitted from `kindOrder`; counts in total but never
  shown as a breakdown row).
- **Global month-selector consistency** (only Dashboard/Budgets/Insights honor it).

## 11. Open Questions

- **Delete semantics:** block deletion of a person/account that has snapshots/contributions,
  or cascade-delete dependents? (Lean: block with a clear message; offer "delete with data".)
- **Seed default:** ship demo data or start investments empty by default? (Lean: demo by
  default, `--investments=empty` to start clean.)
- **`reclassifyTransaction`:** keep client-side/in-memory (current) or persist via a future
  transactions endpoint? (Lean: keep as-is this milestone; revisit when transactions become
  editable.)
