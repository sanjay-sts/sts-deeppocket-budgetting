import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { netWorth, netWorthByKind, netWorthTrend } from '../lib/kpi';
import { cad, cadK, deltaPct, monthLabelShort } from '../lib/format';
import { MoneyCell } from '../components/shared/MoneyCell';

const BUCKET_ORDER = ['cash', 'investments', 'liabilities'] as const;
const BUCKET_COLOR = { cash: '#60a5fa', investments: '#34d399', liabilities: '#f87171' };
const BUCKET_LABEL = { cash: 'Cash', investments: 'Investments', liabilities: 'Liabilities' };

export function NetWorth() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const nw = useMemo(() => netWorth(fixtures), [fixtures]);
  const trend = useMemo(() => netWorthTrend(fixtures), [fixtures]);
  const accById = new Map(fixtures.accounts.map((a) => [a.id, a]));
  const personById = new Map(fixtures.household.map((p) => [p.id, p]));

  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const yoy = trend[Math.max(0, trend.length - 13)];
  const momDelta = prev ? (last!.total - prev.total) / prev.total : 0;
  const yoyDelta = yoy && yoy.total ? (last!.total - yoy.total) / yoy.total : 0;

  // Per-person split (best-effort: first owner of each account)
  const perPerson = new Map<string, number>();
  for (const b of nw.byAccount) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    const owner = acc.beneficiaryIds?.[0] ?? acc.ownerIds[0] ?? 'joint';
    perPerson.set(owner, (perPerson.get(owner) ?? 0) + b.value);
  }
  const perPersonData = [...perPerson.entries()]
    .map(([id, value]) => ({ id, name: personById.get(id)?.name ?? id, value: Math.round(value) }))
    .filter((d) => d.value > 0);

  const PERSON_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24'];

  const rows = useMemo(() => netWorthByKind(fixtures), [fixtures]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-dim">Net worth</div>
            <div className="num text-4xl font-semibold text-ink mt-1">{cad(nw.total, true)}</div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-xs text-ink-dim">vs last month</div>
            <div className={`num text-lg ${momDelta >= 0 ? 'text-up' : 'text-down'}`}>{deltaPct(momDelta)}</div>
            <div className="text-xs text-ink-dim">vs a year ago</div>
            <div className={`num text-lg ${yoyDelta >= 0 ? 'text-up' : 'text-down'}`}>{deltaPct(yoyDelta)}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" title="Trend · 12 months">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.map((p) => ({ ...p, liabilities: -p.liabilities }))}>
                <defs>
                  {BUCKET_ORDER.map((b) => (
                    <linearGradient key={b} id={`g-${b}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BUCKET_COLOR[b]} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={BUCKET_COLOR[b]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="ym" tickFormatter={monthLabelShort} stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => cadK(v as number)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                  labelFormatter={(l) => monthLabelShort(l as string)}
                />
                <Area type="monotone" dataKey="investments" stackId="1" stroke={BUCKET_COLOR.investments} fill="url(#g-investments)" />
                <Area type="monotone" dataKey="cash" stackId="1" stroke={BUCKET_COLOR.cash} fill="url(#g-cash)" />
                <Area type="monotone" dataKey="liabilities" stackId="2" stroke={BUCKET_COLOR.liabilities} fill="url(#g-liabilities)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="By person">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={perPersonData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80}>
                  {perPersonData.map((_, i) => (
                    <Cell key={i} fill={PERSON_COLORS[i % PERSON_COLORS.length]} />
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

      <Card title="Breakdown" subtitle="By account type">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-dim uppercase tracking-wider border-b border-line">
              <th className="py-2">Bucket</th>
              <th className="py-2 text-right">Value</th>
              <th className="py-2 text-right">% of net worth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-2 text-ink">{r.label}</td>
                <td className="py-2 text-right"><MoneyCell amount={r.value} signedDisplay /></td>
                <td className="py-2 text-right num text-ink-muted">
                  {nw.total > 0 ? `${((r.value / nw.total) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 text-ink">Net worth</td>
              <td className="py-2 text-right"><MoneyCell amount={nw.total} /></td>
              <td className="py-2 text-right num text-ink-muted">100.0%</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
