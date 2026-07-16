import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Progress } from '../components/ui/Progress';
import { MoneyCell } from '../components/shared/MoneyCell';
import { budgetStatus, monthTotalsFor, spendByCategory } from '../lib/kpi';
import { cad, cadK, pct } from '../lib/format';
import type { BudgetMode, Bucket503020 } from '../types';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';

const modeTabs: { id: BudgetMode; label: string }[] = [
  { id: 'envelope', label: 'Envelope' },
  { id: 'zero_based', label: 'Zero-based' },
  { id: 'fifty_thirty_twenty', label: '50/30/20' },
];

const bucketColors: Record<Bucket503020, string> = {
  needs: '#60a5fa',
  wants: '#c084fc',
  savings: '#34d399',
};
const BUCKET_TARGET: Record<Bucket503020, number> = { needs: 0.5, wants: 0.3, savings: 0.2 };

export function Budgets() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const ym = useAppStore((s) => s.selectedMonth);
  const budgetMode = useAppStore((s) => s.budgetMode);
  const setBudgetMode = useAppStore((s) => s.setBudgetMode);
  const [localRollover, setLocalRollover] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fixtures.budget.lines.map((l) => [l.categoryId, l.rollover])),
  );

  const catById = new Map(fixtures.categories.map((c) => [c.id, c]));
  const status = useMemo(() => budgetStatus(fixtures, ym, fixtures.budget), [fixtures, ym]);
  const totals = useMemo(() => monthTotalsFor(fixtures, ym), [fixtures, ym]);

  const totalBudgeted = status.reduce((a, s) => a + s.budgeted, 0);
  const totalSpent = status.reduce((a, s) => a + s.spent, 0);
  const surplus = totalBudgeted - totalSpent;
  const unassigned = totals.income - totalBudgeted;

  // 50/30/20 mode: aggregate spend into buckets
  const categories = spendByCategory(fixtures, ym);
  const bucketSpend: Record<Bucket503020, number> = { needs: 0, wants: 0, savings: 0 };
  for (const cs of categories) {
    const cat = catById.get(cs.categoryId);
    const b = cat?.bucket503020;
    if (b) bucketSpend[b] += cs.amount;
  }
  const bucketTotal = bucketSpend.needs + bucketSpend.wants + bucketSpend.savings;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Tabs
          tabs={modeTabs.map((t) => ({ id: t.id, label: t.label }))}
          active={budgetMode}
          onChange={(id) => setBudgetMode(id as BudgetMode)}
        />
        <div className="text-sm text-ink-muted">
          {budgetMode === 'envelope' && 'Per-category monthly caps. Unused amounts roll over if enabled.'}
          {budgetMode === 'zero_based' && 'Every dollar of income must be assigned. Unassigned should reach zero.'}
          {budgetMode === 'fifty_thirty_twenty' && '50% Needs · 30% Wants · 20% Savings'}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Budgeted</div>
          <div className="num text-2xl mt-2 text-ink">{cad(totalBudgeted, true)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Spent</div>
          <div className="num text-2xl mt-2 text-ink">{cad(totalSpent, true)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">
            {budgetMode === 'zero_based' ? 'Unassigned' : 'Surplus / deficit'}
          </div>
          <div className={`num text-2xl mt-2 ${
            budgetMode === 'zero_based'
              ? Math.abs(unassigned) < 1 ? 'text-up' : 'text-amber-400'
              : surplus >= 0 ? 'text-up' : 'text-down'
          }`}>
            {cad(budgetMode === 'zero_based' ? unassigned : surplus, true)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Adherence</div>
          <div className="num text-2xl mt-2 text-ink">
            {pct(status.filter((s) => !s.over).length / Math.max(1, status.length), 0)}
          </div>
          <div className="text-xs text-ink-dim mt-1">
            {status.filter((s) => !s.over).length} of {status.length} categories on track
          </div>
        </Card>
      </div>

      {budgetMode !== 'fifty_thirty_twenty' ? (
        <Card title="Categories" subtitle={ym}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-dim uppercase tracking-wider border-b border-line">
                <th className="py-2">Category</th>
                <th className="py-2 text-right">Budgeted</th>
                <th className="py-2 text-right">Spent</th>
                <th className="py-2 text-right">Remaining</th>
                <th className="py-2 w-1/3">Progress</th>
                {budgetMode === 'envelope' && <th className="py-2 text-center">Rollover</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {status.map((s) => (
                <tr key={s.categoryId} className="hover:bg-bg-hover">
                  <td className="py-2 text-ink">{s.categoryName}</td>
                  <td className="py-2 text-right num text-ink-muted">{cad(s.budgeted, true)}</td>
                  <td className="py-2 text-right num text-ink">{cad(s.spent, true)}</td>
                  <td className={`py-2 text-right num ${s.over ? 'text-down' : 'text-up'}`}>
                    {cad(s.remaining, true)}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <Progress value={s.pctUsed} over={s.over} />
                      <span className="num text-xs text-ink-muted w-10 text-right">{pct(s.pctUsed, 0)}</span>
                    </div>
                  </td>
                  {budgetMode === 'envelope' && (
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={localRollover[s.categoryId] ?? false}
                        onChange={(e) =>
                          setLocalRollover((prev) => ({ ...prev, [s.categoryId]: e.target.checked }))
                        }
                        className="accent-brand"
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" title="50/30/20 · Needs vs Wants vs Savings">
            <div className="space-y-4">
              {(['needs', 'wants', 'savings'] as Bucket503020[]).map((b) => {
                const spent = bucketSpend[b];
                const share = bucketTotal > 0 ? spent / bucketTotal : 0;
                const target = BUCKET_TARGET[b];
                const gap = share - target;
                return (
                  <div key={b}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-ink capitalize">{b}</span>
                      <span className="num text-ink-muted">
                        {cad(spent, true)} · {pct(share, 0)} <span className="text-ink-dim">target {pct(target, 0)}</span>
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-bg-elev overflow-hidden relative">
                      <div
                        className="h-full transition-all"
                        style={{ background: bucketColors[b], width: `${share * 100}%` }}
                      />
                      <div
                        className="absolute top-0 h-full w-px bg-ink-dim"
                        style={{ left: `${target * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-ink-dim mt-1">
                      {Math.abs(gap) < 0.02 ? 'On target' : gap > 0 ? `${pct(gap, 0)} over target` : `${pct(-gap, 0)} under target`}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Distribution">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(['needs', 'wants', 'savings'] as Bucket503020[]).map((b) => ({
                      name: b,
                      value: bucketSpend[b],
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {(['needs', 'wants', 'savings'] as Bucket503020[]).map((b) => (
                      <Cell key={b} fill={bucketColors[b]} />
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
      )}
    </div>
  );
}
