import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { monthTotals, spendByCategory } from '../lib/kpi';
import { cad, cadK, monthLabelShort, monthKey } from '../lib/format';

type Tab = 'spending' | 'income' | 'cashflow' | 'trends';

export function Reports() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const [tab, setTab] = useState<Tab>('spending');

  const totals = useMemo(() => monthTotals(fixtures), [fixtures]);

  // Category trends: top 6 categories stacked by month
  const trendData = useMemo(() => {
    const months = totals.map((m) => m.ym);
    const byMonthCat: Record<string, Record<string, number>> = {};
    for (const m of months) byMonthCat[m] = {};
    const cats = new Map(fixtures.categories.map((c) => [c.id, c]));
    for (const t of fixtures.transactions) {
      if (t.isTransfer || t.amount >= 0) continue;
      const c = cats.get(t.categoryId);
      if (!c || c.group === 'income' || c.group === 'transfers') continue;
      const ym = monthKey(t.date);
      if (!byMonthCat[ym]) continue;
      byMonthCat[ym]![c.name] = (byMonthCat[ym]![c.name] ?? 0) + -t.amount;
    }
    // Top 6 category names
    const totals6: Record<string, number> = {};
    for (const m of months) {
      for (const [k, v] of Object.entries(byMonthCat[m] ?? {})) {
        totals6[k] = (totals6[k] ?? 0) + v;
      }
    }
    const top6 = Object.entries(totals6).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const rows = months.map((ym) => {
      const row: Record<string, number | string> = { ym };
      for (const k of top6) row[k] = Math.round(byMonthCat[ym]![k] ?? 0);
      return row;
    });
    return { rows, keys: top6 };
  }, [fixtures, totals]);

  return (
    <div className="space-y-6">
      <Tabs
        tabs={[
          { id: 'spending', label: 'Spending' },
          { id: 'income', label: 'Income' },
          { id: 'cashflow', label: 'Cash Flow' },
          { id: 'trends', label: 'Category Trends' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'spending' && <SpendingReport fixtures={fixtures} totals={totals} />}
      {tab === 'income' && <IncomeReport totals={totals} />}
      {tab === 'cashflow' && <CashflowReport totals={totals} />}
      {tab === 'trends' && (
        <Card title="Category trend · top 6 categories" subtitle="Last 12 months">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                  labelFormatter={(l) => monthLabelShort(l as string)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                {trendData.keys.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={['#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24', '#22d3ee'][i]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}

function SpendingReport({ fixtures, totals }: { fixtures: ReturnType<typeof useAppStore.getState>['fixtures']; totals: ReturnType<typeof monthTotals> }) {
  // Honour the global month selector; fall back to the latest month (issue #9).
  const selectedMonth = useAppStore((s) => s.selectedMonth);
  if (!fixtures) return null;
  const ym = selectedMonth || (totals[totals.length - 1]?.ym ?? '');
  const cats = spendByCategory(fixtures, ym);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title={`${ym} category spend`}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {cats.map((c) => (
              <tr key={c.categoryId}>
                <td className="py-2 text-ink">{c.categoryName}</td>
                <td className="py-2 text-right num text-ink-muted">{cad(c.amount, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="12 month expense total">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={totals}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                formatter={(v: number) => cad(v, true)}
              />
              <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function IncomeReport({ totals }: { totals: ReturnType<typeof monthTotals> }) {
  return (
    <Card title="Income · 12 months">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={totals}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
              formatter={(v: number) => cad(v, true)}
            />
            <Bar dataKey="income" fill="#34d399" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CashflowReport({ totals }: { totals: ReturnType<typeof monthTotals> }) {
  return (
    <Card title="Cash flow" subtitle="Net income after expenses each month">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={totals}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
              formatter={(v: number) => cad(v, true)}
            />
            <Bar dataKey="net" fill="#60a5fa" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
