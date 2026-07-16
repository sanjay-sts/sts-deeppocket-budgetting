import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useAppStore } from '../store/useAppStore';
import {
  monthTotals,
  monthTotalsFor,
  netWorth,
  netWorthTrend,
  spendByCategory,
  burnRate3mo,
  budgetStatus,
} from '../lib/kpi';
import { cad, cadK, monthLabelShort, pct } from '../lib/format';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/shared/KpiCard';
import { Progress } from '../components/ui/Progress';
import { MoneyCell } from '../components/shared/MoneyCell';
import { Badge } from '../components/ui/Badge';

const CAT_COLORS = [
  '#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24',
  '#22d3ee', '#a3e635', '#fb923c', '#818cf8', '#f87171',
];

export function Dashboard() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const ym = useAppStore((s) => s.selectedMonth);

  const totals = useMemo(() => monthTotals(fixtures), [fixtures]);
  const thisMonth = useMemo(() => monthTotalsFor(fixtures, ym), [fixtures, ym]);
  const prevYm = totals[totals.findIndex((m) => m.ym === ym) - 1]?.ym;
  const prev = prevYm ? monthTotalsFor(fixtures, prevYm) : null;
  const nw = useMemo(() => netWorth(fixtures), [fixtures]);
  const trend = useMemo(() => netWorthTrend(fixtures), [fixtures]);
  const categories = useMemo(() => spendByCategory(fixtures, ym), [fixtures, ym]);
  const budget = useMemo(
    () => budgetStatus(fixtures, ym, fixtures.budget),
    [fixtures, ym],
  );
  const burn = burnRate3mo(fixtures, ym);

  const trendPrev = trend[trend.length - 2];
  const trendLast = trend[trend.length - 1];
  const nwDeltaPct =
    trendPrev && trendLast ? (trendLast.total - trendPrev.total) / trendPrev.total : 0;

  const incomeDelta = prev && prev.income ? (thisMonth.income - prev.income) / prev.income : 0;
  const expenseDelta = prev && prev.expense ? (thisMonth.expense - prev.expense) / prev.expense : 0;
  const savingsRateDelta = prev ? thisMonth.savingsRate - prev.savingsRate : 0;

  const latestInvTotal = nw.investments;
  const prevInvTotal =
    trendPrev?.investments ??
    (trend[trend.length - 3]?.investments ?? latestInvTotal);
  const invDelta = prevInvTotal ? (latestInvTotal - prevInvTotal) / prevInvTotal : 0;

  const recent = [...fixtures.transactions]
    .filter((t) => !t.isTransfer && t.amount < 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const catsById = new Map(fixtures.categories.map((c) => [c.id, c]));
  const accById = new Map(fixtures.accounts.map((a) => [a.id, a]));

  const topBudgetLines = [...budget]
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 6);

  // Alerts
  const alerts: { tone: 'warning' | 'negative' | 'info'; text: string }[] = [];
  const over = budget.filter((b) => b.over);
  if (over.length) {
    alerts.push({
      tone: 'negative',
      text: `${over.length} ${over.length === 1 ? 'category is' : 'categories are'} over budget this month`,
    });
  }
  if (thisMonth.savingsRate < 0.1 && thisMonth.income > 0) {
    alerts.push({
      tone: 'warning',
      text: `Savings rate dropped to ${pct(thisMonth.savingsRate, 0)} — target is 20%`,
    });
  }
  if (thisMonth.expense > burn * 1.2 && burn > 0) {
    alerts.push({
      tone: 'warning',
      text: 'Monthly expenses are 20% above your 3-month average burn rate',
    });
  }

  const incomeSpark = totals.map((m) => m.income);
  const expenseSpark = totals.map((m) => m.expense);
  const savingsSpark = totals.map((m) => Math.max(0, m.savingsRate * 100));
  const nwSpark = trend.map((p) => p.total);
  const invSpark = trend.map((p) => p.investments);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Net Worth"
          value={cad(nw.total, true)}
          deltaPctValue={nwDeltaPct}
          spark={nwSpark}
          hint={`${cadK(nw.investments)} invested · ${cadK(nw.cash)} cash`}
        />
        <KpiCard
          label="Monthly Income"
          value={cad(thisMonth.income, true)}
          deltaPctValue={incomeDelta}
          spark={incomeSpark}
        />
        <KpiCard
          label="Monthly Expenses"
          value={cad(thisMonth.expense, true)}
          deltaPctValue={expenseDelta}
          spark={expenseSpark}
          positiveIsGood={false}
        />
        <KpiCard
          label="Savings Rate"
          value={pct(thisMonth.savingsRate, 0)}
          deltaPctValue={savingsRateDelta}
          spark={savingsSpark}
          hint={`target 20% · burn ${cadK(burn)}/mo`}
        />
        <KpiCard
          label="Investments"
          value={cad(nw.investments, true)}
          deltaPctValue={invDelta}
          spark={invSpark}
          hint="all accounts, latest month"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" title="Net Worth · 12 months" subtitle="Cash + investments − liabilities">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                  labelFormatter={(l) => monthLabelShort(l as string)}
                />
                <Area type="monotone" dataKey="investments" stackId="1" stroke="#34d399" fill="url(#gInv)" />
                <Area type="monotone" dataKey="cash" stackId="1" stroke="#60a5fa" fill="url(#gCash)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Spending by Category" subtitle={`${categories.length} categories this month`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories.slice(0, 8)}
                  dataKey="amount"
                  nameKey="categoryName"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {categories.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" title="Income vs Expenses" subtitle="12 months trailing">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={totals}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                  labelFormatter={(l) => monthLabelShort(l as string)}
                />
                <Bar dataKey="income" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Budget Health" subtitle="Top categories this month">
          <div className="space-y-3">
            {topBudgetLines.map((b) => (
              <div key={b.categoryId}>
                <div className="flex justify-between items-baseline text-sm mb-1">
                  <span className="text-ink">{b.categoryName}</span>
                  <span className="num text-ink-muted">
                    {cad(b.spent, true)} / {cad(b.budgeted, true)}
                  </span>
                </div>
                <Progress value={b.pctUsed} over={b.over} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" title="Recent Transactions">
          <div className="divide-y divide-line">
            {recent.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-bg-elev text-ink-muted flex items-center justify-center text-xs shrink-0">
                    {t.merchant.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{t.merchant}</div>
                    <div className="text-xs text-ink-dim">
                      {accById.get(t.accountId)?.name ?? t.accountId} · {catsById.get(t.categoryId)?.name}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <MoneyCell amount={t.amount} signedDisplay />
                  <div className="text-xs text-ink-dim">{t.date}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Alerts" subtitle={alerts.length ? `${alerts.length} active` : 'All clear'}>
          {alerts.length === 0 ? (
            <div className="text-sm text-ink-muted py-6 text-center">Nothing to flag this month.</div>
          ) : (
            <div className="space-y-3">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge tone={a.tone}>!</Badge>
                  <div className="text-sm text-ink">{a.text}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
