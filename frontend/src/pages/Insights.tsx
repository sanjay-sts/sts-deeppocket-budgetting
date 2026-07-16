import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { MoneyCell } from '../components/shared/MoneyCell';
import { topMerchants, recurringSubscriptions, avgDailySpend, monthTotalsFor, burnRate3mo } from '../lib/kpi';
import { cad, cadK, formatDate } from '../lib/format';

export function Insights() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const ym = useAppStore((s) => s.selectedMonth);

  const merchants = useMemo(() => topMerchants(fixtures, ym, 10), [fixtures, ym]);
  const subs = useMemo(() => recurringSubscriptions(fixtures), [fixtures]);
  const avg = avgDailySpend(fixtures, ym);
  const monthTotal = monthTotalsFor(fixtures, ym);
  const burn = burnRate3mo(fixtures, ym);
  const subsTotal = subs.reduce((a, s) => a + s.monthlyAmount, 0);

  // Day-of-week spending
  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const t of fixtures.transactions) {
    if (t.isTransfer || t.amount > 0) continue;
    if (!t.date.startsWith(ym)) continue;
    const d = new Date(t.date + 'T00:00:00');
    dowTotals[d.getDay()] += -t.amount;
  }
  const dowMax = Math.max(...dowTotals, 1);
  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Avg daily spend</div>
          <div className="num text-2xl mt-2 text-ink">{cad(avg, true)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Subscriptions</div>
          <div className="num text-2xl mt-2 text-ink">{cad(subsTotal, true)}</div>
          <div className="text-xs text-ink-dim mt-1">{subs.length} recurring</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">3-month burn</div>
          <div className="num text-2xl mt-2 text-ink">{cad(burn, true)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Cost this month</div>
          <div className="num text-2xl mt-2 text-ink">{cad(monthTotal.expense, true)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Top merchants" subtitle={`${ym} · ranked by spend`}>
          <div className="divide-y divide-line">
            {merchants.map((m, i) => (
              <div key={m.merchant} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-6 text-ink-dim num text-xs">{i + 1}</div>
                  <div>
                    <div className="text-sm text-ink">{m.merchant}</div>
                    <div className="text-xs text-ink-dim">{m.count} transaction{m.count !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <MoneyCell amount={m.total} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Recurring subscriptions" subtitle={`${subs.length} detected`}>
          <div className="divide-y divide-line">
            {subs.map((s) => (
              <div key={s.merchant} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-ink">{s.merchant}</div>
                  <div className="text-xs text-ink-dim">
                    since {formatDate(s.firstSeen)} · {s.occurrences}x
                  </div>
                </div>
                <div className="num text-ink">{cad(s.monthlyAmount, false)}/mo</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Spending by day of week" subtitle={ym}>
        <div className="grid grid-cols-7 gap-3">
          {dowLabels.map((lbl, i) => {
            const v = dowTotals[i] ?? 0;
            const h = 20 + (v / dowMax) * 100;
            return (
              <div key={lbl} className="flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center" style={{ height: 130 }}>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: h,
                      background: `rgba(52, 211, 153, ${0.3 + (v / dowMax) * 0.7})`,
                    }}
                  />
                </div>
                <div className="text-xs text-ink-dim">{lbl}</div>
                <div className="text-xs num text-ink-muted">{cadK(v)}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
