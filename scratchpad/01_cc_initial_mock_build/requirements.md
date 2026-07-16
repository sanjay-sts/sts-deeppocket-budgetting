# Requirements — Milestone 01 (Initial Mock Build)

## Functional

### Data generation (`mock/generate.py`)

- Produces 12 months of data ending at today's month, deterministic with `--seed`.
- Household: Sanjay, Anumol, Kid1, Kid2 (kids are first-class entities).
- Accounts:
  - Chequing/savings: `sanjay_chequing`, `sanjay_savings`, `anumol_chequing`, `joint_savings`
  - Credit cards: `sanjay_td_visa`, `sanjay_amex_cobalt`, `anumol_rbc_avion`
  - Investments: TFSA × 3 (Sanjay × 2 institutions, Anumol × 1), RRSP × 2, RESP × 2 (one per kid, beneficiary tagged), FHSA × 2 (Sanjay, Anumol), DCPP (Sanjay/Sunlife), Crypto (Sanjay/Wealthsimple)
- Outputs in user's exact CSV schemas:
  - `bank_transactions.csv`: `Date, Transaction_detail, withdrawal, deposit, running_total, account`
  - `credit_card.csv`: `Date, merchant, amount, <blank>, running_total`
  - `investments.csv`: `date, person, institution, account_type, amount`
- Plus normalized `fixtures.json` for the frontend.
- Realistic Canadian merchants, intentionally messy strings (`AMZN Mktp CA*XD4BI0T33`).
- Recurring patterns: biweekly salary, monthly mortgage/utilities/daycare/subscriptions/insurance, weekly groceries/gas/dining, random shopping/travel.
- Auto-generated CC payments matching each statement cycle.
- Investment snapshots: ~6–8% annualized growth + Gaussian volatility; crypto higher volatility.
- **Contribution events** seeded:
  - TFSA: monthly DCA into Sanjay & Anumol TFSAs
  - RRSP: Feb lump-sum + payroll DCPP for Sanjay
  - RESP: $208/month per kid (full $500 CESG/yr)
  - FHSA: monthly DCA
- **CESG grants** auto-credited month after RESP contribution (20%, $500/kid/yr cap, $7,200 lifetime cap).
- **CCB** monthly deposit into joint chequing.

### Frontend screens (10)

#### 1. Dashboard
- KPI card row with MoM delta + sparkline: **Net Worth · Monthly Income · Monthly Expenses · Savings Rate · Investment Value**
- Net worth trend chart (12 months, stacked area: cash / investments / property / liabilities)
- Income vs Expenses bar chart (12 months)
- Spending by category donut (current month)
- Budget health list (top 5 categories with progress bars; red if over)
- Recent transactions list (last 10, inline category edit)
- Alerts panel (overspend, unusual merchant, subscription price change)

#### 2. Transactions
- Virtualized table; columns: date · merchant · category · account · person · amount · tags · notes
- Filters: date range · account · category · person · amount range · search
- Inline category edit (changes propagate to Dashboard/Budgets/Reports via shared `lib/kpi.ts`)
- Bulk re-categorize toolbar
- Split-transaction modal
- Duplicate detection badge
- Tags & notes per transaction
- CSV export

#### 3. Budgets — three switchable modes
- Mode tabs at top: **Envelope (rollover)** [default] · **Zero-based** · **50/30/20**
- Common: month selector + "copy previous month", category rows (budgeted/spent/remaining/% used), total row with surplus/deficit, 6-month adherence mini-chart
- Envelope mode: per-category roll-over toggle
- Zero-based mode: "unassigned" counter at top must reach $0; inline "move money" between categories
- 50/30/20 mode: Needs/Wants/Savings buckets; categories tagged into a bucket; donut shows actual vs target
- Mode switch is non-destructive (envelope caps survive a switch to 50/30/20 view)

#### 4. Net Worth
- Headline number with MoM and YoY delta
- Stacked area: assets vs liabilities over time
- Breakdown table by bucket: Cash · Registered (TFSA/RRSP/RESP/FHSA) · Non-registered · Pension (DCPP) · Crypto · Property (manual entry) · Liabilities (mortgage, CC balances)
- Per-person split pie
- Goal line (target net worth by date)

#### 5. Investments + CESG dashboard
- Table: person · institution · account_type · latest value · MoM delta · 6-month sparkline
- Group-by toggle: person / institution / account_type
- Asset allocation donut
- **Contribution-room tracker** for TFSA, RRSP, RESP, FHSA (2025 CRA limits baked in):
  - TFSA $7,000/yr
  - RRSP 18% prior-year earned income up to $32,490
  - RESP $50,000 lifetime per child; $2,500/yr to maximize CESG
  - FHSA $8,000/yr, $40,000 lifetime
  - Per-person rows: room used / remaining / projected year-end
- **CESG dashboard per kid**: contributions YTD · CESG received YTD · CESG remaining this year ($500 cap) · CESG remaining lifetime ($7,200 cap) · "on track / behind / maxed" badge
- **Tax-impact hints**: e.g. "Sanjay has $X RRSP room — at his marginal rate this is ~$Y refund"; "RESP contribution before Dec 31 unlocks $Z CESG you'd otherwise lose"
- "Add monthly snapshot" form (edits the in-memory fixture in M1)

#### 6. Reports
- Tabs: Spending · Income · Cash Flow · Category Trends · Year Comparison
- Sankey: income sources → categories → savings
- Time-range selector
- CSV/PDF export

#### 7. Insights
- Top 10 merchants (amount and frequency)
- Recurring subscriptions detected (amount, cadence, first seen)
- Unusual spending alerts (category z-score)
- Day-of-week heatmap
- Category MoM trend sparklines
- Cost-per-day this month

#### 8. Accounts
- One card per account: balance · type · owner · last txn · mini trend
- Credit card utilization %

#### 9. Import (stubbed in M1)
- Drag-drop CSV
- Source-type picker (chequing / credit card / investment)
- Auto-detect columns, preview table, duplicate highlight, auto-categorize preview
- M1 walks through the already-generated CSVs without committing

#### 10. Settings
- Household members (edit names, ages of kids)
- **Budget mode picker** (Envelope / Zero-based / 50/30/20) with explanation of each
- Categories, rules, merchant aliases
- Currency (CAD locked in M1)
- Theme (light/dark)
- Backup/restore

### Cross-cutting

- All KPIs computed by pure functions in `frontend/src/lib/kpi.ts` so Dashboard, Budgets, Reports, Insights stay consistent.
- `frontend/src/data/api.ts` is the only place that knows where data comes from — swap fixtures → FastAPI in M2 with no other changes.
- Reclassifying a transaction must propagate consistently to every screen.

## Non-functional

- **Currency:** CAD only.
- **Locale:** en-CA. Dates as `YYYY-MM-DD` in storage, `MMM D, YYYY` in display.
- **Tax-aware:** 2025 CRA limits baked into the contribution-room logic.
- **Deterministic:** mock generator must be reproducible from `--seed`.
- **Local-only:** runs entirely in the browser against a static JSON fixture. No backend, no auth, no network.
- **Theme:** dark-mode friendly out of the box; light mode supported via Tailwind class strategy.
- **Responsive:** Dashboard and Transactions layouts must hold at mobile width (≤375 px). Other screens may be desktop-first in M1.
- **Performance:** Transactions table virtualized so 12 months × ~200 txns/month feels instant.
- **Type safety:** TS strict mode; no `any` in `lib/kpi.ts` or `types/`.
- **Documentation:** scratchpad docs (this folder) updated as work progresses.

## Out of scope for M1

- FastAPI backend.
- SQLite or any persistent storage beyond the fixture file.
- Real CSV import (the Import screen is a stub walkthrough).
- Multi-user auth.
- PDF export (CSV only).
- Mobile-first layout for screens beyond Dashboard and Transactions.
- ML-based categorization (rules-only in M1).
- Multi-currency.
- Mobile app / Electron wrapper.
