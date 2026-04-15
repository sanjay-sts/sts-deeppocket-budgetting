// Pure KPI functions. Single source of truth for every screen.
// Any number the user sees on the Dashboard, Budgets, Reports, or Insights
// screens comes from one of these functions — so reclassifying a transaction
// updates everything consistently.

import type {
  Account,
  Budget,
  Category,
  CategoryId,
  Fixtures,
  InvestmentSnapshot,
  PersonId,
  Transaction,
} from '../types';
import { daysInMonth, monthKey } from './format';

export interface MonthTotals {
  ym: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
}

function byMonth(transactions: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const ym = monthKey(t.date);
    const arr = out.get(ym) ?? [];
    arr.push(t);
    out.set(ym, arr);
  }
  return out;
}

function catIndex(categories: Category[]): Map<CategoryId, Category> {
  return new Map(categories.map((c) => [c.id, c]));
}

function isSpend(t: Transaction, cats: Map<CategoryId, Category>): boolean {
  if (t.isTransfer) return false;
  const c = cats.get(t.categoryId);
  if (!c) return false;
  if (c.group === 'transfers' || c.group === 'income') return false;
  return t.amount < 0;
}

function isIncome(t: Transaction, cats: Map<CategoryId, Category>): boolean {
  if (t.isTransfer) return false;
  const c = cats.get(t.categoryId);
  if (!c) return false;
  return c.group === 'income' && t.amount > 0;
}

export function monthTotals(fixtures: Fixtures): MonthTotals[] {
  const cats = catIndex(fixtures.categories);
  const m = byMonth(fixtures.transactions);
  const out: MonthTotals[] = [];
  const sorted = [...m.keys()].sort();
  for (const ym of sorted) {
    const txs = m.get(ym)!;
    const income = txs.reduce((acc, t) => (isIncome(t, cats) ? acc + t.amount : acc), 0);
    const expense = txs.reduce((acc, t) => (isSpend(t, cats) ? acc + -t.amount : acc), 0);
    const net = income - expense;
    const savingsRate = income > 0 ? net / income : 0;
    out.push({
      ym,
      income: round2(income),
      expense: round2(expense),
      net: round2(net),
      savingsRate,
    });
  }
  return out;
}

export function monthTotalsFor(fixtures: Fixtures, ym: string): MonthTotals {
  return monthTotals(fixtures).find((m) => m.ym === ym) ?? {
    ym,
    income: 0,
    expense: 0,
    net: 0,
    savingsRate: 0,
  };
}

export function burnRate3mo(fixtures: Fixtures, ym: string): number {
  const totals = monthTotals(fixtures);
  const idx = totals.findIndex((m) => m.ym === ym);
  if (idx < 0) return 0;
  const start = Math.max(0, idx - 2);
  const window = totals.slice(start, idx + 1);
  if (window.length === 0) return 0;
  return round2(window.reduce((a, m) => a + m.expense, 0) / window.length);
}

// -------------------- Balances & Net Worth --------------------

export interface AccountBalance {
  accountId: string;
  balance: number;
}

export function latestCashBalances(fixtures: Fixtures): AccountBalance[] {
  const cashKinds: Account['kind'][] = ['chequing', 'savings'];
  const result: AccountBalance[] = [];
  for (const acc of fixtures.accounts) {
    if (!cashKinds.includes(acc.kind)) continue;
    const opening = fixtures.meta.openingBalances[acc.id] ?? 0;
    const delta = fixtures.transactions
      .filter((t) => t.accountId === acc.id)
      .reduce((a, t) => a + t.amount, 0);
    result.push({ accountId: acc.id, balance: round2(opening + delta) });
  }
  return result;
}

export function latestCreditCardOwing(fixtures: Fixtures): AccountBalance[] {
  const result: AccountBalance[] = [];
  for (const acc of fixtures.accounts) {
    if (acc.kind !== 'credit_card') continue;
    const delta = fixtures.transactions
      .filter((t) => t.accountId === acc.id)
      .reduce((a, t) => a + t.amount, 0);
    // CC internal sum is negative when balance is owed; invert for display.
    result.push({ accountId: acc.id, balance: round2(-delta) });
  }
  return result;
}

export function latestInvestmentSnapshot(fixtures: Fixtures): InvestmentSnapshot[] {
  const byAcc = new Map<string, InvestmentSnapshot>();
  const sorted = [...fixtures.investments].sort((a, b) => a.date.localeCompare(b.date));
  for (const s of sorted) byAcc.set(s.accountId, s);
  return [...byAcc.values()];
}

export interface NetWorthBreakdown {
  cash: number;
  investments: number;
  liabilities: number;
  total: number;
  byAccount: { accountId: string; value: number; bucket: 'cash' | 'investments' | 'liabilities' }[];
}

export function netWorth(fixtures: Fixtures): NetWorthBreakdown {
  const cashBalances = latestCashBalances(fixtures);
  const ccOwed = latestCreditCardOwing(fixtures);
  const latestInv = latestInvestmentSnapshot(fixtures);

  const cash = cashBalances.reduce((a, b) => a + b.balance, 0);
  const investments = latestInv.reduce((a, s) => a + s.amount, 0);
  const liabilities = ccOwed.reduce((a, b) => a + b.balance, 0);

  const byAccount: NetWorthBreakdown['byAccount'] = [
    ...cashBalances.map((b) => ({ accountId: b.accountId, value: b.balance, bucket: 'cash' as const })),
    ...latestInv.map((s) => ({ accountId: s.accountId, value: s.amount, bucket: 'investments' as const })),
    ...ccOwed.map((b) => ({ accountId: b.accountId, value: -b.balance, bucket: 'liabilities' as const })),
  ];

  return {
    cash: round2(cash),
    investments: round2(investments),
    liabilities: round2(liabilities),
    total: round2(cash + investments - liabilities),
    byAccount,
  };
}

// Net-worth trend — one snapshot per month end, using end-of-month cash deltas
// plus the investment snapshot for that month, minus CC balance at month end.
export interface NetWorthPoint {
  ym: string;
  cash: number;
  investments: number;
  liabilities: number;
  total: number;
}

export function netWorthTrend(fixtures: Fixtures): NetWorthPoint[] {
  const months = [...new Set(fixtures.investments.map((s) => monthKey(s.date)))].sort();
  const cashAccountIds = new Set(
    fixtures.accounts.filter((a) => a.kind === 'chequing' || a.kind === 'savings').map((a) => a.id),
  );
  const ccAccountIds = new Set(
    fixtures.accounts.filter((a) => a.kind === 'credit_card').map((a) => a.id),
  );

  const points: NetWorthPoint[] = [];
  for (const ym of months) {
    // Cash = opening + sum of transactions up to end of this month
    let cash = 0;
    for (const [accId, open] of Object.entries(fixtures.meta.openingBalances)) {
      if (!cashAccountIds.has(accId)) continue;
      cash += open;
    }
    cash += fixtures.transactions
      .filter((t) => cashAccountIds.has(t.accountId) && monthKey(t.date) <= ym)
      .reduce((a, t) => a + t.amount, 0);

    // Liabilities: CC net (internal negative → invert)
    const ccDelta = fixtures.transactions
      .filter((t) => ccAccountIds.has(t.accountId) && monthKey(t.date) <= ym)
      .reduce((a, t) => a + t.amount, 0);
    const liabilities = Math.max(0, -ccDelta);

    // Investments = sum of latest snapshot for this month per account
    const thisMonthSnaps = fixtures.investments.filter((s) => monthKey(s.date) === ym);
    const investments = thisMonthSnaps.reduce((a, s) => a + s.amount, 0);

    points.push({
      ym,
      cash: round2(cash),
      investments: round2(investments),
      liabilities: round2(liabilities),
      total: round2(cash + investments - liabilities),
    });
  }
  return points;
}

// -------------------- Category KPIs --------------------

export interface CategorySpend {
  categoryId: CategoryId;
  categoryName: string;
  group: Category['group'];
  amount: number;
}

export function spendByCategory(fixtures: Fixtures, ym: string): CategorySpend[] {
  const cats = catIndex(fixtures.categories);
  const map = new Map<CategoryId, number>();
  for (const t of fixtures.transactions) {
    if (monthKey(t.date) !== ym) continue;
    if (!isSpend(t, cats)) continue;
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + -t.amount);
  }
  const out: CategorySpend[] = [];
  for (const [id, amount] of map) {
    const c = cats.get(id)!;
    out.push({ categoryId: id, categoryName: c.name, group: c.group, amount: round2(amount) });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}

export interface BudgetLineStatus {
  categoryId: CategoryId;
  categoryName: string;
  budgeted: number;
  spent: number;
  remaining: number;
  pctUsed: number;
  over: boolean;
}

export function budgetStatus(fixtures: Fixtures, ym: string, budget: Budget): BudgetLineStatus[] {
  const spendMap = new Map(spendByCategory(fixtures, ym).map((s) => [s.categoryId, s.amount]));
  const catsById = catIndex(fixtures.categories);
  return budget.lines.map((line) => {
    const spent = spendMap.get(line.categoryId) ?? 0;
    const budgeted = line.monthlyCap;
    const remaining = budgeted - spent;
    return {
      categoryId: line.categoryId,
      categoryName: catsById.get(line.categoryId)?.name ?? line.categoryId,
      budgeted,
      spent: round2(spent),
      remaining: round2(remaining),
      pctUsed: budgeted > 0 ? spent / budgeted : 0,
      over: spent > budgeted,
    };
  });
}

export function budgetAdherenceRate(status: BudgetLineStatus[]): number {
  if (status.length === 0) return 1;
  return status.filter((s) => !s.over).length / status.length;
}

// -------------------- Habit KPIs --------------------

export interface MerchantTotals {
  merchant: string;
  count: number;
  total: number;
}

export function topMerchants(fixtures: Fixtures, ym: string | null, n = 10): MerchantTotals[] {
  const cats = catIndex(fixtures.categories);
  const map = new Map<string, MerchantTotals>();
  for (const t of fixtures.transactions) {
    if (ym && monthKey(t.date) !== ym) continue;
    if (!isSpend(t, cats)) continue;
    const existing = map.get(t.merchant) ?? { merchant: t.merchant, count: 0, total: 0 };
    existing.count += 1;
    existing.total += -t.amount;
    map.set(t.merchant, existing);
  }
  return [...map.values()]
    .map((m) => ({ ...m, total: round2(m.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export interface RecurringSubscription {
  merchant: string;
  monthlyAmount: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export function recurringSubscriptions(fixtures: Fixtures): RecurringSubscription[] {
  const subsCategory = 'subscriptions';
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of fixtures.transactions) {
    if (t.categoryId !== subsCategory) continue;
    const arr = byMerchant.get(t.merchant) ?? [];
    arr.push(t);
    byMerchant.set(t.merchant, arr);
  }
  const out: RecurringSubscription[] = [];
  for (const [merchant, txs] of byMerchant) {
    if (txs.length < 2) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const avg = txs.reduce((a, t) => a + -t.amount, 0) / txs.length;
    out.push({
      merchant,
      monthlyAmount: round2(avg),
      firstSeen: txs[0]!.date,
      lastSeen: txs[txs.length - 1]!.date,
      occurrences: txs.length,
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

export function avgDailySpend(fixtures: Fixtures, ym: string): number {
  const total = monthTotalsFor(fixtures, ym).expense;
  return round2(total / daysInMonth(ym));
}

// -------------------- Income split --------------------

export function incomeByPerson(fixtures: Fixtures, ym: string): Record<PersonId, number> {
  const cats = catIndex(fixtures.categories);
  const accById = new Map(fixtures.accounts.map((a) => [a.id, a]));
  const map: Record<string, number> = {};
  for (const t of fixtures.transactions) {
    if (monthKey(t.date) !== ym) continue;
    if (!isIncome(t, cats)) continue;
    const ownerId = t.personId ?? accById.get(t.accountId)?.ownerIds[0] ?? 'unknown';
    map[ownerId] = (map[ownerId] ?? 0) + t.amount;
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, round2(v)]));
}

// -------------------- Helpers --------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function latestMonthKey(fixtures: Fixtures): string {
  const all = monthTotals(fixtures).map((m) => m.ym);
  return all[all.length - 1] ?? '';
}

export function monthKeys(fixtures: Fixtures): string[] {
  return monthTotals(fixtures).map((m) => m.ym);
}

// -------------------- Inline sanity checks --------------------
// These run once at module load so a broken KPI shows up immediately
// in the dev console rather than drifting silently on the UI.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selfTest(): void {
  const fakeCats: Category[] = [
    { id: 'salary', name: 'Salary', group: 'income' },
    { id: 'groceries', name: 'Groceries', group: 'essentials' },
    { id: 'transfer', name: 'Transfer', group: 'transfers' },
  ];
  const fakeTxs: Transaction[] = [
    { id: '1', date: '2026-03-15', accountId: 'a1', rawMerchant: 'X', merchant: 'X', amount: 5000, categoryId: 'salary' },
    { id: '2', date: '2026-03-20', accountId: 'a1', rawMerchant: 'Y', merchant: 'Y', amount: -500, categoryId: 'groceries' },
    { id: '3', date: '2026-03-25', accountId: 'a1', rawMerchant: 'Z', merchant: 'Z', amount: -100, categoryId: 'transfer', isTransfer: true },
  ];
  const fake: Fixtures = {
    household: [],
    accounts: [],
    categories: fakeCats,
    rules: [],
    transactions: fakeTxs,
    investments: [],
    contributionEvents: [],
    cesgGrants: [],
    budget: { mode: 'envelope', lines: [] },
    craLimits: {
      TFSA_ANNUAL: 7000, RRSP_ANNUAL_PCT: 0.18, RRSP_ANNUAL_CAP: 32490,
      RESP_LIFETIME_PER_CHILD: 50000, RESP_ANNUAL_FOR_FULL_CESG: 2500,
      FHSA_ANNUAL: 8000, FHSA_LIFETIME: 40000, CESG_RATE: 0.2,
      CESG_ANNUAL_PER_CHILD: 500, CESG_LIFETIME_PER_CHILD: 7200,
    },
    meta: { generatedAt: '2026-03-31', seed: 0, monthsCovered: 1, openingBalances: {} },
  };
  const t = monthTotalsFor(fake, '2026-03');
  if (t.income !== 5000) throw new Error(`kpi self-test: income=${t.income}, expected 5000`);
  if (t.expense !== 500) throw new Error(`kpi self-test: expense=${t.expense}, expected 500`);
  if (Math.abs(t.savingsRate - 0.9) > 0.0001) throw new Error(`kpi self-test: savingsRate=${t.savingsRate}`);
}

if (typeof window !== 'undefined') {
  try { selfTest(); } catch (e) { console.error('[kpi.ts self-test]', e); }
}
