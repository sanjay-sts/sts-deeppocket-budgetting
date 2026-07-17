---
name: verify
description: Build/launch/drive recipe for verifying DeepPocket changes end-to-end (FastAPI backend + Vite frontend + Playwright)
---

# Verifying DeepPocket changes

Two processes, then drive the UI with the Playwright MCP tools.

## Launch

```bash
# backend (from backend/) — uv manages the venv
uv run seed.py                          # idempotent; --investments=empty to start clean
uv run uvicorn app.main:app --port 8000 # run in background

# frontend (from frontend/) — proxies /api -> :8000
npm run dev                             # http://localhost:5173, run in background
```

Wait ~4s, then sanity-check both: `curl -s http://localhost:8000/api/data` (JSON payload)
and `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173` (200).

## Gotchas

- **Schema changes need a DB rebuild**: no migrations — `rm backend/deeppocket.db && uv run seed.py`.
  The backend test suite uses an isolated in-memory DB and is unaffected.
- Since M3 the `/api/data` payload is composed **entirely from SQLite** — `fixtures.json`
  is seed input only (`uv run seed.py`), so a stale DB (not the fixtures file) explains odd data.
- First page load shows "Loading fixtures…" briefly; take a fresh `browser_snapshot` if the
  first one catches it.
- The favicon 404 console error is pre-existing noise.
- **Stale dev servers squat on :5173** — Vite silently falls forward (5174, 5175, …) and an
  old M1-era server on 5173 serves index.html for `/api/*` ("Unexpected token '<'" in console,
  app stuck on "Loading fixtures…"). Always read the `npm run dev` output for the real port
  before navigating.
- API state is easiest to assert via `curl -s http://localhost:8000/api/data | python -c ...`
  alongside the UI check.

## Flows worth driving

- **Settings** (`/settings`): household + investment-account CRUD, owner/beneficiary
  multi-selects (button opens checkbox dropdown), danger-zone purges (type-to-confirm).
- **Investments**: snapshot grid, add/update value form, contributions grid → room/CESG cards.
- **Import**: investments CSV upload (samples in `mock/out/*.csv`).

Restore demo data after mutating checks: revert via the UI, or Danger zone → "Reset to demo
data", or reseed from the CLI.
