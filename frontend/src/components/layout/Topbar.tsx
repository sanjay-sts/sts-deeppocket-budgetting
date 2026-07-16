import { useAppStore } from '../../store/useAppStore';
import { monthLabel } from '../../lib/format';

export function Topbar({ title }: { title: string }) {
  const { fixtures, selectedMonth, setSelectedMonth } = useAppStore();
  const months = fixtures
    ? [...new Set(fixtures.transactions.map((t) => t.date.slice(0, 7)))].sort()
    : [];

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-line bg-bg-elev">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="text-xs text-ink-dim mt-0.5">Deep Pocket · family finance hub</p>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-ink-dim">Month</label>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="bg-bg-card border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
