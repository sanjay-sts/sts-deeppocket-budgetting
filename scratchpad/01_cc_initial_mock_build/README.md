# Milestone 01 — Initial Mock Build

This folder is the working memory for **Milestone 1** of the DeepPocket finance app: build a deterministic mock data generator and a React frontend that loads it, so we can iterate on the UX before writing a real backend.

## Why this milestone exists

Sanjay wants one app that bundles expense tracking, budgeting, investments, net worth, transaction classification, reporting, and spending-habit analysis — built for his Canadian family first. No existing Canadian app does all of this well together.

Rather than start with a real database and importer, we generate realistic 12 months of mock data matching the three real CSV schemas Sanjay will eventually feed in (chequing/savings, credit card, investment snapshots), then build the React frontend against that. This lets us nail the UX and KPI definitions before locking the backend.

## How the docs in this folder relate

| Doc | Lifetime | Purpose |
|---|---|---|
| [`plan.md`](plan.md) | Frozen | Verbatim copy of the approved plan. The "what we agreed to build" contract. |
| [`requirements.md`](requirements.md) | Frozen (until scope change) | Functional + non-functional + out-of-scope. |
| [`design.md`](design.md) | Frozen (until scope change) | Architecture, data model (TS interfaces), screen map, KPI formulas, categorization pipeline. |
| [`task_list.md`](task_list.md) | **Live** | Ordered checklist with status. Updated continuously. |
| [`implementation.md`](implementation.md) | **Live** | Running journal: decisions made during coding, gotchas, deviations. |
| [`run_and_test.md`](run_and_test.md) | Frozen | Exact commands to regenerate mock data, run the app, and verify. |

## Where the code lives

| Area | Path |
|---|---|
| Mock data generator | `mock/generate.py` |
| Generated CSVs | `mock/out/{bank_transactions,credit_card,investments}.csv` |
| Normalized fixture for the frontend | `mock/out/fixtures.json` |
| Frontend app | `frontend/` |
| Future FastAPI backend | `backend/` (stub in M1) |

## Status

Milestone 1 is **in progress**. See [`task_list.md`](task_list.md) for the live checklist.

## Next milestone

**Milestone 2** will build the FastAPI backend + SQLite + a real CSV importer that consumes the same three schemas the mock generator already produces. The frontend's `data/api.ts` swaps from "load fixtures.json" to "fetch from FastAPI" — no other frontend changes needed if the contract holds.
