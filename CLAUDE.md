# CLAUDE.md

Guidance for working in **DeepPocket** — a local-only Canadian family personal-finance app.

## What this is

A single-household budgeting and net-worth tracker for a Canadian family (two adults, two kids).
It models Canadian registered accounts (TFSA / RRSP / RESP / FHSA), contribution room against
CRA limits, and RESP → CESG grant tracking.

**Current state:** Milestone 3 shipped — the entire `/api/data` payload is now DB-backed
(the fixtures file is seed input only). Transactions are editable (category, transfer/
duplicate flags, notes, tags via `PATCH`; bank facts like amount/date/merchant stay
immutable). Bank and credit-card CSV import ships with header auto-detection and
idempotent dedup (`POST /api/import/transactions-csv`, UI card on the Import page next to
the investments card). Auto-categorization runs history → user-editable rules →
unclassified (rules CRUD at `/api/rules`, managed in a Settings "Categorization rules"
card, with a create-rule prompt after reclassify on the Transactions page). See
`docs/superpowers/specs/2026-07-16-m3-editable-transactions-design.md`.

**In progress: Milestone 4** (branch `m4-editable-categories-budgets`) — editable
categories/budgets and manual cash entry. Spec:
`docs/superpowers/specs/2026-07-17-m4-editable-categories-budgets-design.md`; plan (11 tasks):
`docs/superpowers/plans/2026-07-17-m4-editable-categories-budgets.md`. Done: Task 1
(`Transaction.source` + merchant index, `cash` kind, seeded `cash_wallet` account) and
Task 2 (category CRUD at `/api/categories` with cascade delete to `unclassified`).
**Next: Task 3** — budget router (`PUT/DELETE /api/budget/lines/{categoryId}`,
`PATCH /api/budget/config`).

## Layout

```
frontend/              Vite + React 18 + TypeScript (strict) + Tailwind — the app
  src/data/api.ts      THE DATA SEAM — the only place data enters the app (see below)
  src/data/fixtures.json   generated mock data the app reads at boot
  src/store/useAppStore.ts Zustand store — single in-memory source of truth
  src/lib/             PURE functions: kpi.ts, canadian.ts, format.ts, account.ts
  src/pages/           10 route screens (Dashboard, Transactions, … Settings)
  src/components/      layout/ + shared/ + ui/ presentational components
  src/types/index.ts   all shared TypeScript types (Fixtures shape lives here)
mock/generate.py       Python generator → fixtures.json + 3 sample CSVs
mock/out/              generated artifacts (fixtures.json, *.csv)
docs/superpowers/specs/  design specs (start here for M2)
backend/               FastAPI + SQLModel + SQLite (managed with uv; DB file deeppocket.db)
```

## Commands

Run from `frontend/`:

| Command | What |
|---|---|
| `npm install` | install deps (first time) |
| `npm run dev` | dev server on **http://localhost:5173** |
| `npm run build` | typecheck (`tsc --noEmit`) **and** production build |
| `npm run typecheck` | types only — fast feedback |
| `npm test` | Vitest unit/component tests |

Run from `backend/` (needs [uv](https://docs.astral.sh/uv/)):

| Command | What |
|---|---|
| `uv run pytest -q` | backend tests |
| `uv run seed.py` | seed `deeppocket.db` — after any schema change, delete `deeppocket.db` first (seed.py adds tables but never alters existing ones) |
| `uv run uvicorn app.main:app --port 8000` | API server (frontend dev server proxies `/api` → :8000) |

Regenerate mock data (from repo root, needs Python 3.11+):

```
python mock/generate.py
```

This writes `mock/out/fixtures.json` **and** copies it into `frontend/src/data/fixtures.json`
(via the default `--frontend-data frontend/src/data`). The frontend reads that copy.

## Architecture — the one rule that matters

**Data enters the app through exactly one seam: `frontend/src/data/api.ts`.**

```
mock/generate.py → fixtures.json → api.ts (loadFixtures) → useAppStore (Zustand)
                                                              → lib/kpi.ts + lib/canadian.ts (pure)
                                                              → pages render
```

- `api.ts` is the *only* module that knows where data comes from. M1 imports a static JSON;
  M2 swaps `loadFixtures()` to `fetch('/api/data')` and adds write methods — **nothing else
  should change** in the screens. If a feature needs to touch the data source, it goes through
  `api.ts`, never around it.
- `mock/generate.py → fixtures.json` is now **seed input only**: `uv run seed.py` reads it
  once to (re)populate `deeppocket.db`. The running app never reads the fixtures file — it's
  not a runtime dependency.
- `useAppStore.ts` is the single source of truth. Screens read from it; they do not fetch.
  `init()` loads fixtures once. State: `selectedMonth`, `budgetMode`, plus `reclassifyTransaction`
  (persists via optimistic update + `PATCH /api/transactions/{id}` + refetch, M3).
- **`lib/kpi.ts` and `lib/canadian.ts` are PURE.** No fetch, no store access, no side effects —
  they take fixtures/args and return derived numbers. Keep them that way so they stay trivially
  testable and screens stay thin. All KPI/allocation/room/CESG math lives here, not in components.

## Conventions

- **TypeScript strict.** No `any` escape hatches; add types to `src/types/index.ts`.
- **Path alias:** `@` → `frontend/src` (configured in `vite.config.ts` + `tsconfig.json`).
- **Money/dates:** format only via `lib/format.ts`. Dates are ISO `YYYY-MM-DD` strings.
- **Canadian logic** (contribution room, CESG) lives in `lib/canadian.ts`; the 2025 CRA limits
  are in `CRA_LIMITS_2025` there. CESG is 20% of RESP contributions, capped $500/yr/child and
  $7,200 lifetime — and in M2 it is **derived**, never hand-entered.
- **Components** are presentational; business logic belongs in `lib/`. Reuse `components/ui/*`
  (Button, Card, Badge, Progress, Tabs) before adding new primitives.

## Known gaps (tracked on the GitHub project board)

- `date-fns` is declared in `package.json` but currently unused.
- Categories & budgets are in the DB but not yet editable — being built now in M4 (see "In progress" above).

## Working here

- Read the relevant spec in `docs/superpowers/specs/` before starting a milestone feature.
- Don't bypass the `api.ts` seam or push math into components — both are load-bearing for M2.
- Match the existing file's style (naming, comment density, Tailwind usage) when editing.
