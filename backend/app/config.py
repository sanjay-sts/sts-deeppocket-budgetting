import os
from pathlib import Path

# repo-root/backend/app/config.py -> parents[2] == repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_PATH = REPO_ROOT / "mock" / "out" / "fixtures.json"

# Default on-disk SQLite db lives next to seed.py (backend/deeppocket.db). Override with
# DEEPPOCKET_DB to run against a throwaway database — seeding demo data or rebuilding
# after a schema change then never touches the real one.
DB_PATH = Path(os.environ.get("DEEPPOCKET_DB") or (REPO_ROOT / "backend" / "deeppocket.db"))
DB_URL = f"sqlite:///{DB_PATH}"

# Vite dev origins allowed to call the API.
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
