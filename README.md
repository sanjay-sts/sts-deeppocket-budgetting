# sts-deeppocket-budgetting
sts-deeppocket-budgetting-mybudgetting app.

## Running locally

DeepPocket is two processes: a FastAPI backend (SQLite) and the Vite frontend.

### Backend (from `backend/`)

Uses [uv](https://docs.astral.sh/uv/) for the virtualenv and dependencies.

```bash
uv sync                        # creates .venv + installs from pyproject.toml/uv.lock
uv run seed.py                 # seed demo data  (or: uv run seed.py --investments=empty)
uv run uvicorn app.main:app --port 8000
```

### Frontend (from `frontend/`)

```bash
npm install
npm run dev                    # http://localhost:5173 (proxies /api -> :8000)
```

### Tests

```bash
# backend (from backend/)
uv run pytest -q
# frontend (from frontend/)
npm test
```

### Regenerating mock data

```bash
python mock/generate.py        # writes mock/out/ + frontend/src/data/fixtures.json
```
