# Run & Test — Milestone 01

## Prerequisites

- Python ≥ 3.11 (stdlib only — no pip install needed)
- Node ≥ 20 and npm ≥ 10

## 1. Regenerate mock data

From the repo root:

```bash
python mock/generate.py --seed 42
```

Produces:

- `mock/out/bank_transactions.csv`
- `mock/out/credit_card.csv`
- `mock/out/investments.csv`
- `mock/out/fixtures.json`
- `frontend/src/data/fixtures.json`  (auto-copied so the frontend picks it up)

Flags:

- `--seed N` — change the seed to get different (still-deterministic) data.
- `--months N` — change the window (default 12).
- `--out path/` — change the output directory (default `mock/out`).

## 2. Install + run the frontend

```bash
cd frontend
npm install
npm run dev
```

App is served at `http://localhost:5173`.

Other commands:

```bash
npm run build     # production build into dist/
npm run preview   # preview the production build
npm run typecheck # tsc --noEmit
```

## 3. Manual verification walkthrough

Tick each item against the running app:

- [ ] **Dashboard loads** — five KPI cards show numbers (not "—"), net worth chart renders 12 months, category donut has slices.
- [ ] **KPI parity** — pick a month, compute `Σ income − Σ expenses` from `fixtures.json` by hand (or with `jq`/Python), confirm it matches Dashboard "Savings Rate" denominator on that month's view.
- [ ] **Reclassify a transaction** — change a transaction's category on the Transactions page, then return to Dashboard / Budgets / Reports — totals must update consistently. (Proves `lib/kpi.ts` is the single source of truth.)
- [ ] **Investments → CESG dashboard** — for each kid, "CESG captured YTD" + "CESG remaining" = $500 (current year), and the badge says "on track" if contributions are pacing.
- [ ] **Budget mode switch** — toggle Envelope → Zero-based → 50/30/20 — totals do not change, only the layout.
- [ ] **Mobile resize** — Chrome DevTools, 375 px wide. Dashboard and Transactions must remain usable; sidebar collapses to a hamburger.

## 4. Spot-check from the command line

Quick KPI sanity check using just Python and `fixtures.json`:

```bash
python -c "
import json
f = json.load(open('mock/out/fixtures.json'))
month = '2026-03'
txns = [t for t in f['transactions'] if t['date'].startswith(month) and not t.get('isTransfer')]
income = sum(t['amount'] for t in txns if t['amount'] > 0)
expense = -sum(t['amount'] for t in txns if t['amount'] < 0)
print(f'{month}: income=\${income:,.2f} expense=\${expense:,.2f} savings_rate={(income-expense)/income*100:.1f}%')
"
```

Compare the printed numbers to Dashboard for the same month — they should match exactly.

## 5. Resetting / re-seeding

The mock data is the source of truth in M1. To start over:

```bash
rm -rf mock/out frontend/src/data/fixtures.json
python mock/generate.py --seed 42
```

The frontend is stateless except for in-memory edits in the zustand store; reloading the browser tab gets you back to the freshly generated fixtures.
