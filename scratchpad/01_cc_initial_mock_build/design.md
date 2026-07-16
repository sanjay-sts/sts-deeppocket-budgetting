# Design — Milestone 01 (Initial Mock Build)

## High-level architecture

```
┌─────────────────────┐
│  mock/generate.py   │   Python, deterministic --seed
│  (Canadian family   │
│   data simulator)   │
└──────────┬──────────┘
           │ writes
           ▼
┌─────────────────────────────────────────────┐
│  mock/out/                                  │
│   ├── bank_transactions.csv (user schema)   │
│   ├── credit_card.csv       (user schema)   │
│   ├── investments.csv       (user schema)   │
│   └── fixtures.json         (normalized)    │
└──────────┬──────────────────────────────────┘
           │ copied / symlinked into
           ▼
┌─────────────────────────────────────────────┐
│  frontend/src/data/                         │
│   ├── fixtures.json                         │
│   └── api.ts          ← single seam         │
└──────────┬──────────────────────────────────┘
           │ imports
           ▼
┌─────────────────────────────────────────────┐
│  frontend/src/lib/                          │
│   ├── kpi.ts          (pure KPI functions)  │
│   ├── categorize.ts   (rules + alias)       │
│   └── format.ts       (CAD/dates/percent)   │
└──────────┬──────────────────────────────────┘
           │ used by
           ▼
┌─────────────────────────────────────────────┐
│  frontend/src/pages/  (10 screens)          │
│   Dashboard · Transactions · Budgets ·      │
│   NetWorth · Investments · Reports ·        │
│   Insights · Accounts · Import · Settings   │
└─────────────────────────────────────────────┘
```

In Milestone 2, only `frontend/src/data/api.ts` changes: it stops importing `fixtures.json` and starts calling FastAPI. Nothing else in the frontend cares.

## Data model (TypeScript)

```ts
// frontend/src/types/index.ts

export type PersonId = string;
export type AccountId = string;
export type CategoryId = string;
export type IsoDate = string; // YYYY-MM-DD

export type PersonRole = 'adult' | 'child';
export interface Person {
  id: PersonId;
  name: string;
  role: PersonRole;
  birthYear?: number;        // for kids: drives age-out logic on RESP
}

export type AccountKind =
  | 'chequing' | 'savings'
  | 'credit_card'
  | 'tfsa' | 'rrsp' | 'resp' | 'fhsa' | 'dcpp' | 'non_registered' | 'crypto';

export interface Account {
  id: AccountId;
  name: string;
  kind: AccountKind;
  institution: string;
  ownerIds: PersonId[];      // joint accounts have multiple
  beneficiaryId?: PersonId;  // for RESP — which kid
  isLiability?: boolean;     // credit cards true; mortgage tracked manually
}

export interface Transaction {
  id: string;
  date: IsoDate;
  accountId: AccountId;
  rawMerchant: string;       // as it appeared on statement
  merchant: string;          // resolved alias
  amount: number;            // signed: + inflow, - outflow
  categoryId: CategoryId;
  personId?: PersonId;       // who made the spend (default = first owner)
  tags?: string[];
  notes?: string;
  isTransfer?: boolean;      // excluded from spend KPIs
  isDuplicate?: boolean;
}

export interface InvestmentSnapshot {
  date: IsoDate;             // last day of month
  accountId: AccountId;
  amount: number;            // CAD market value
}

export type ContributionAccountKind = 'tfsa' | 'rrsp' | 'resp' | 'fhsa';
export interface ContributionEvent {
  id: string;
  date: IsoDate;
  accountId: AccountId;
  personId: PersonId;        // who contributed (matters for room)
  beneficiaryId?: PersonId;  // for RESP: which kid the contribution counts toward
  amount: number;
  kind: ContributionAccountKind;
}

export interface CesgGrant {
  id: string;
  date: IsoDate;
  beneficiaryId: PersonId;   // the kid
  contributionEventId: string;
  amount: number;            // 20% of contribution, capped at $500/yr/kid
}

export type CategoryGroup =
  | 'essentials' | 'lifestyle' | 'family' | 'financial' | 'transfers' | 'income';

export interface Category {
  id: CategoryId;
  name: string;
  group: CategoryGroup;
  bucket503020?: 'needs' | 'wants' | 'savings'; // for 50/30/20 mode
  isEssential?: boolean;
}

export interface Rule {
  id: string;
  matcher: { kind: 'contains' | 'regex'; value: string };
  categoryId: CategoryId;
  tag?: string;
  order: number;
}

export type BudgetMode = 'envelope' | 'zero_based' | 'fifty_thirty_twenty';

export interface BudgetLine {
  categoryId: CategoryId;
  monthlyCap: number;
  rollover: boolean;         // envelope mode only
}

export interface Budget {
  mode: BudgetMode;
  lines: BudgetLine[];
  targetSavingsRate?: number; // for 50/30/20
}

export interface Fixtures {
  household: Person[];
  accounts: Account[];
  transactions: Transaction[];
  investments: InvestmentSnapshot[];
  contributionEvents: ContributionEvent[];
  cesgGrants: CesgGrant[];
  categories: Category[];
  rules: Rule[];
  budget: Budget;
  meta: {
    generatedAt: IsoDate;
    seed: number;
    monthsCovered: number;
  };
}
```

## Screen map

| # | Page | Route | Reads |
|---|---|---|---|
| 1 | Dashboard | `/` | transactions, investments, accounts, budget |
| 2 | Transactions | `/transactions` | transactions, accounts, categories, rules |
| 3 | Budgets | `/budgets` | transactions, budget, categories |
| 4 | Net Worth | `/networth` | accounts, transactions, investments |
| 5 | Investments | `/investments` | investments, accounts, contributionEvents, cesgGrants, household |
| 6 | Reports | `/reports` | transactions, categories |
| 7 | Insights | `/insights` | transactions, categories |
| 8 | Accounts | `/accounts` | accounts, transactions, investments |
| 9 | Import | `/import` | (stub) |
| 10 | Settings | `/settings` | household, budget, categories, rules |

## KPI formulas (single source of truth in `lib/kpi.ts`)

| KPI | Formula | Inputs | Displayed on |
|---|---|---|---|
| **Net Worth** | Σ(latest investment values) + Σ(cash account balances) − Σ(liabilities) | accounts, latest investments | Dashboard, Net Worth |
| **Monthly Income** | Σ amount where category.group = 'income' AND month = M | transactions | Dashboard, Reports |
| **Monthly Expenses** | Σ \|amount\| where amount < 0 AND NOT isTransfer AND month = M | transactions | Dashboard, Budgets, Reports |
| **Savings Rate** | (Income − Expenses) / Income | as above | Dashboard, Reports |
| **Burn Rate (3mo)** | mean(Monthly Expenses for last 3 months) | transactions | Dashboard |
| **Runway** | Σ(liquid cash balances) / Burn Rate | accounts, transactions | Dashboard |
| **Emergency Fund Coverage** | savings balance / Σ essential monthly expenses | accounts, transactions, categories | Dashboard |
| **Budget Adherence Rate** | count(category spent ≤ cap) / count(budget lines) | transactions, budget | Budgets, Dashboard |
| **Discretionary Ratio** | Σ non-essential expenses / Σ all expenses | transactions, categories | Budgets, Insights |
| **Top-5 Category Share** | top 5 categories by spend / total spend | transactions, categories | Budgets |
| **Asset Allocation** | groupBy(latest investments, accountKind) | investments, accounts | Investments, Net Worth |
| **Contribution Room Used** | Σ contributionEvents YTD per (person, accountKind) | contributionEvents | Investments |
| **CESG Captured YTD** | Σ cesgGrants where year = current AND beneficiaryId = kid | cesgGrants | Investments |
| **CESG Remaining YTD** | min($500, $7200 − cesg_lifetime) − CESG Captured YTD | cesgGrants | Investments |
| **Avg Daily Spend** | Monthly Expenses / days in month | transactions | Insights |
| **Recurring Subs Total** | Σ amount where category = 'subscriptions' AND recurring detected | transactions | Insights |

## Categorization pipeline

```
raw transaction.merchant
    │
    ▼ alias lookup (collapses messy strings)
"AMZN Mktp CA*XD4BI0T33" → "Amazon.ca"
    │
    ▼ rules engine (ordered list)
matcher: contains "Amazon.ca" → category: shopping
    │
    ▼
Transaction.merchant = "Amazon.ca"
Transaction.categoryId = "shopping"
```

If no rule matches → `categoryId = "unclassified"`, surfaces in Transactions review queue.

Aliases and rules both live in `fixtures.json` for M1. In M2 they move to the database.

## Frontend folder structure

```
frontend/src/
├── components/
│   ├── ui/              button.tsx, card.tsx, table.tsx, dialog.tsx, input.tsx, tabs.tsx, badge.tsx, progress.tsx
│   ├── charts/          LineChart.tsx, BarChart.tsx, AreaChart.tsx, DonutChart.tsx, Sparkline.tsx, Heatmap.tsx
│   ├── layout/          Shell.tsx, Sidebar.tsx, Topbar.tsx
│   └── shared/          KpiCard.tsx, MoneyCell.tsx, CategoryBadge.tsx, PersonChip.tsx, Sparkline.tsx
├── pages/
│   ├── Dashboard.tsx
│   ├── Transactions.tsx
│   ├── Budgets.tsx
│   ├── NetWorth.tsx
│   ├── Investments.tsx
│   ├── Reports.tsx
│   ├── Insights.tsx
│   ├── Accounts.tsx
│   ├── Import.tsx
│   └── Settings.tsx
├── data/
│   ├── api.ts           (loadFixtures(): Promise<Fixtures>)
│   └── fixtures.json    (copied from mock/out)
├── lib/
│   ├── kpi.ts
│   ├── categorize.ts
│   ├── format.ts
│   └── canadian.ts      (CRA limits, CESG calc, marginal rate hints)
├── store/
│   └── useAppStore.ts   (zustand: selectedMonth, filters, household overrides, budgetMode)
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

## CRA / Canadian constants (`lib/canadian.ts`)

```ts
export const CRA_LIMITS_2025 = {
  TFSA_ANNUAL: 7000,
  RRSP_ANNUAL_PCT: 0.18,
  RRSP_ANNUAL_CAP: 32490,
  RESP_LIFETIME_PER_CHILD: 50000,
  RESP_ANNUAL_FOR_FULL_CESG: 2500,
  FHSA_ANNUAL: 8000,
  FHSA_LIFETIME: 40000,
  CESG_RATE: 0.20,
  CESG_ANNUAL_PER_CHILD: 500,
  CESG_LIFETIME_PER_CHILD: 7200,
};
```

## Open design notes

- **Sankey chart** in Reports: use `recharts` `Sankey` component (built-in).
- **Virtualized table** in Transactions: roll our own with `react-window` if needed; for M1 a simple paginated table is fine if 12 months × ~200 txns is small enough.
- **State persistence** in M1: zustand store is in-memory only; reloading the page resets edits. That's acceptable for an M1 prototype since the source of truth is `fixtures.json`. M2 adds backend persistence.
- **Reclassification reactivity**: pages read from a derived selector that filters from the zustand-held copy of `fixtures.json`. Editing a transaction's category mutates the store copy, all pages re-render.
