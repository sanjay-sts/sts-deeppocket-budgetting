# sts-deeppocket-budgetting
sts-deeppocket-budgetting-mybudgetting app.

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
