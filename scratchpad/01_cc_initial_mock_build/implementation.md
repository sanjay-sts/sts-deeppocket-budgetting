# Implementation Journal — Milestone 01

A running log of decisions, gotchas, and deviations as the milestone is built. Append-only-ish; older entries stay even when superseded so we have a paper trail.

---

## 2026-04-13 — kickoff

- Plan approved (see `plan.md`). User chose: mock-only frontend for M1, all three budget modes switchable, deepest Canadian registered-account treatment (incl. CESG), household = Sanjay + Anumol + 2 kids.
- Created this scratchpad folder with the seven docs Sanjay asked for.
- Next: write `mock/generate.py`, then scaffold `frontend/`.

## Decisions

_(append as you make them)_

- **Charting library: recharts.** Reasoning: bundled `Sankey` and `AreaChart`, lighter than visx, ergonomic with React. Don't switch unless we hit a specific limitation.
- **State: zustand (single store).** No React context proliferation; selectors keep re-renders local. Sufficient for M1 since there's no server state.
- **Tailwind tokens:** dark-default. `bg-slate-950` shell, `bg-slate-900` cards, accent `emerald-500` for positive deltas, `rose-500` for negative.
- **No shadcn/ui dependency.** We write a handful of small primitives ourselves to keep the dependency footprint minimal. shadcn-style API (variant props, Radix-like composition) but no install.

## Gotchas

- **Windows console can't print `→`.** First run of `mock/generate.py` crashed with `UnicodeEncodeError` because the final print had an arrow. Replaced with `->`. Lesson: keep generator output ASCII-only on Windows unless we set `PYTHONIOENCODING=utf-8`.
- **CC running totals were initially negative.** I'd treated credit cards like cash accounts — `sum(amounts)` produces a negative number when you owe money. Fixed in `assign_running_totals` by flipping the sign for `credit_card` kind, so `running_total` now represents *amount owed* (positive when you're in debt, matching how a real CC statement reads).
- **Chequing went $20k in the red.** First pass had Sanjay's chequing paying mortgage + daycare + utilities + insurance + all subscriptions + contributions out of one $7k/mo salary. Split expenses across both adults' chequing accounts (Sanjay pays mortgage + his utilities; Anumol pays daycare + home insurance + her cell line) and bumped salaries to realistic dual-earner numbers (~$115k + ~$65k).
- **CC payment carry-over bug.** The end-of-month CC balance formula forgot to add the start-of-month balance back in after the payment, so payments alternated between ~$0 and ~$2k instead of cleanly clearing each statement. Fixed by computing `end = max(0, start + charges - payments)`.

## Spot-check numbers

After `python mock/generate.py --seed 42 --today 2026-04-13`:

- **Months covered:** 12 (2025-05 through 2026-04)
- **Total transactions:** 864
- **Investment snapshots:** 144 (12 accounts × 12 months)
- **Contribution events:** 121
- **CESG grants:** 24 (12 × 2 kids)

Sample months:

| Month | Income | Expenses | Savings rate |
|---|---|---|---|
| 2026-02 | $15,337.82 | $9,119.16 | 40.5% |
| 2026-03 | $15,465.18 | $10,582.07 | 31.6% |
| 2026-04 | $17,776.85 | $8,755.30 | 50.7% |

(Apr 2026 income is elevated by the $2,480 CRA tax refund.)

- **Latest investment total (2026-04-30):** $294,211.61 across 12 accounts
- **CESG per kid lifetime total (12 months):** $499.20 (2,496 contribution × 20%)
- **CESG per kid YTD 2026:** $208.00 (on track, ahead of $166.67 pacing for 4 months elapsed)

## Frontend verification

- `npx tsc --noEmit` → exit 0 (strict mode, no errors)
- `npm run build` → ✓ built in 2.50s, 873 modules, gzipped bundle 207 kB
- `npm run dev` → Vite v5.4.21 ready in 248 ms on http://localhost:5173
- All 10 routes compile and render
- Inline `selfTest()` at the bottom of `lib/kpi.ts` runs on import; fake-fixture asserts `income=$5000`, `expense=$500`, `savingsRate=0.9` — catches regressions in the core KPI functions immediately on page load.
