# DeepPocket — Personal Finance Hub for a Canadian Family

> Verbatim copy of the approved plan at `C:\Users\sanjaysts\.claude\plans\playful-chasing-minsky.md` (approved 2026-04-13).

## Context

Sanjay wants one app that bundles expense tracking, budget planning, investments, net-worth tracking, transaction classification, reporting, and spending-habit analysis — built for his own family first. No Canadian app today covers all of these well together.

Three data sources are available, all spreadsheet / CSV:

1. **Bank chequing & savings** — `Date, Transaction_detail, withdrawal, deposit, running_total, account`
2. **Credit card bills** — `Date, merchant, amount, <blank>, running_total` (future: card holder)
3. **Investment snapshots (monthly)** — `date, person, institution, account_type, amount`; carry-forward the last known value if a month is missing.

Stack: Python backend (FastAPI planned for Milestone 2) + React + Vite + TypeScript + Tailwind frontend.

**Milestone 1 scope:** generate realistic 12 months of Canadian family mock data matching the three schemas above, then build the React frontend reading from JSON fixtures so we can iterate on UX fast. Frontend data access is behind a thin `api.ts` module so swapping fixtures for a real FastAPI call in Milestone 2 is a one-file change.

**Decisions locked in:**
- M1 = mock frontend only. Python script generates CSVs + `fixtures.json`; React reads JSON directly.
- Budget engine supports **all three philosophies** — zero-based, envelope-with-rollover, and 50/30/20 — switchable from Settings. Default = envelope with rollover.
- Canadian registered accounts get the **deepest treatment**: balances + 2025 CRA contribution-room tracking + RESP CESG grant tracking with basic tax-impact hints.
- Household = **Sanjay + Anumol + 2 kids**. Kids are first-class entities so RESP/CCB/daycare attribute correctly.

## Repo layout

```
sts-deeppocket-budgetting/
├── scratchpad/01_cc_initial_mock_build/   # this folder
├── mock/
│   ├── generate.py                        # deterministic mock data generator
│   └── out/{bank_transactions,credit_card,investments}.csv + fixtures.json
├── frontend/
│   └── src/{components,pages,data,lib,store,types}/
├── backend/                               # stub in M1, built in M2
└── README.md
```

## Mock data generator

Deterministic with `--seed` flag, produces 12 months ending at today.

**Household:** Sanjay (primary earner), Anumol (secondary earner), Kid1 + Kid2.

**Accounts:** TD chequing (Sanjay & Anumol), TD savings (Sanjay), EQ Bank joint savings, three credit cards (Sanjay TD Visa, Sanjay Amex Cobalt, Anumol RBC Avion), 11 investment accounts (Sanjay's 7 from sample + Anumol's 2 from sample + 2 FHSAs).

**Behaviour:** biweekly salary deposits, monthly recurring (mortgage, utilities, daycare, subscriptions, insurance), weekly groceries/gas/dining, random shopping, summer/holiday travel spikes. Auto-generated CC payments. Investment growth ~6–8% with Gaussian noise. RESP contributions trigger CESG grants (20% match, capped). CCB monthly deposits.

**Outputs:** 3 CSVs in user's exact column formats + normalized `fixtures.json` with `{ household, accounts, transactions, investments, contributionEvents, cesgGrants, categories, rules, budget, budgetMode }`.

## Ten frontend screens

1. **Dashboard** — KPI cards (Net Worth · Income · Expenses · Savings Rate · Investments) + net worth area + income/expense bars + category donut + budget health + recent txns + alerts
2. **Transactions** — filterable virtualized table, inline edit, bulk re-cat, split modal, dup detection
3. **Budgets** — three switchable modes (envelope/zero-based/50-30-20)
4. **Net Worth** — headline, asset/liability area, breakdown table, per-person pie, goal line
5. **Investments** — table, allocation donut, contribution-room tracker, **CESG dashboard**, tax hints
6. **Reports** — Spending/Income/Cash Flow/Trends/Year tabs, Sankey
7. **Insights** — top merchants, recurring subs, anomalies, day-of-week heatmap, MoM trends
8. **Accounts** — card per account
9. **Import** — drag-drop CSV (stubbed in M1)
10. **Settings** — household, **budget mode picker**, categories, rules, theme

## Recommended KPIs

- **Headline:** Net Worth, Savings Rate (target ≥20%), Monthly Burn Rate (3mo trailing avg), Runway, Emergency Fund Coverage (3–6 months target)
- **Budget:** Adherence Rate, Discretionary Ratio, Top-5 Category Share
- **Investments:** Total Invested, Contribution Room Utilization (TFSA/RRSP/RESP/FHSA 2025 limits), Allocation Drift, **CESG Captured YTD**, **Free money on the table** alert
- **Habits:** Avg Daily Spend, Recurring Subscription Total, Cash vs Credit, Essentials vs Lifestyle, Per-person spending
- **Income:** Primary/Secondary/Passive split

## Transaction classification

Rule-first: **merchant alias table** → **rules engine** (ordered contains/regex) → **category tree** (Essentials / Lifestyle / Family / Financial / Transfers / Income). Unclassified surfaces in a review queue.

## Verification

1. `python mock/generate.py --seed 42` produces three CSVs + `fixtures.json`
2. `cd frontend && npm install && npm run dev` serves at `http://localhost:5173`
3. Walk all 10 screens; spot-check Dashboard savings rate against hand-calculated month
4. Reclassify a transaction → confirm Dashboard, Budgets, Reports all move consistently (proves single source of truth)
5. Resize to mobile width → Dashboard and Transactions layouts hold
