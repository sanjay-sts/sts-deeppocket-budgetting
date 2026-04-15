import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { MoneyCell } from '../components/shared/MoneyCell';
import { CategoryBadge } from '../components/shared/CategoryBadge';
import { formatDate } from '../lib/format';
import { Button } from '../components/ui/Button';

export function Transactions() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const reclassify = useAppStore((s) => s.reclassifyTransaction);

  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('all');

  const accById = new Map(fixtures.accounts.map((a) => [a.id, a]));
  const catById = new Map(fixtures.categories.map((c) => [c.id, c]));
  const months = useMemo(
    () => [...new Set(fixtures.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [fixtures],
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return fixtures.transactions
      .filter((t) => {
        if (accountFilter !== 'all' && t.accountId !== accountFilter) return false;
        if (categoryFilter !== 'all' && t.categoryId !== categoryFilter) return false;
        if (monthFilter !== 'all' && !t.date.startsWith(monthFilter)) return false;
        if (s) {
          const hay = `${t.merchant} ${t.rawMerchant}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 500);
  }, [fixtures.transactions, accountFilter, categoryFilter, monthFilter, search]);

  const totalInflow = rows.reduce((a, t) => (t.amount > 0 ? a + t.amount : a), 0);
  const totalOutflow = rows.reduce((a, t) => (t.amount < 0 ? a + -t.amount : a), 0);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants…"
            className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-64"
          />
          <FilterSelect value={monthFilter} onChange={setMonthFilter} label="Month">
            <option value="all">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={accountFilter} onChange={setAccountFilter} label="Account">
            <option value="all">All accounts</option>
            {fixtures.accounts
              .filter((a) => a.kind !== 'tfsa' && a.kind !== 'rrsp' && a.kind !== 'resp' && a.kind !== 'fhsa' && a.kind !== 'dcpp' && a.kind !== 'crypto')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect value={categoryFilter} onChange={setCategoryFilter} label="Category">
            <option value="all">All categories</option>
            {fixtures.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <div className="text-ink-muted">
              <span className="text-xs text-ink-dim mr-1">inflow</span>
              <MoneyCell amount={totalInflow} className="text-up" />
            </div>
            <div className="text-ink-muted">
              <span className="text-xs text-ink-dim mr-1">outflow</span>
              <MoneyCell amount={-totalOutflow} className="text-down" />
            </div>
            <Button variant="ghost" onClick={() => { setSearch(''); setAccountFilter('all'); setCategoryFilter('all'); setMonthFilter('all'); }}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`${rows.length} transactions`} subtitle={rows.length === 500 ? 'showing first 500' : undefined}>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-dim uppercase tracking-wider border-b border-line">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Merchant</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Account</th>
                <th className="py-2 pr-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => {
                const cat = catById.get(t.categoryId)!;
                const acc = accById.get(t.accountId);
                return (
                  <tr key={t.id} className="hover:bg-bg-hover">
                    <td className="py-2 pr-4 text-ink-muted whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="py-2 pr-4 text-ink">
                      <div>{t.merchant}</div>
                      <div className="text-xs text-ink-dim truncate max-w-[220px]">{t.rawMerchant}</div>
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        value={t.categoryId}
                        onChange={(e) => reclassify(t.id, e.target.value)}
                        className="bg-transparent border-0 text-xs focus:outline-none cursor-pointer text-ink-muted hover:text-ink"
                      >
                        {fixtures.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1"><CategoryBadge category={cat} /></div>
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">{acc?.name ?? t.accountId}</td>
                    <td className="py-2 pr-4 text-right">
                      <MoneyCell amount={t.amount} signedDisplay whole={false} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-dim">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
      >
        {children}
      </select>
    </label>
  );
}
