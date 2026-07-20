import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { MoneyCell } from '../components/shared/MoneyCell';
import { CategoryBadge } from '../components/shared/CategoryBadge';
import { Badge } from '../components/ui/Badge';
import { formatDate } from '../lib/format';
import { Button } from '../components/ui/Button';

export function Transactions() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const reclassify = useAppStore((s) => s.reclassifyTransaction);
  const editTransaction = useAppStore((s) => s.editTransaction);
  const addRule = useAppStore((s) => s.addRule);
  const addTransaction = useAppStore((s) => s.addTransaction);
  const removeTransaction = useAppStore((s) => s.removeTransaction);

  // After a reclassify, offer to make it a rule ("Always categorize X as Y?").
  const [rulePrompt, setRulePrompt] = useState<{ txId: string; merchant: string; categoryId: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  // Clear stale expanded/prompt state when filters change so a row that
  // disappears (or reappears) doesn't carry over an unrelated editor/prompt.
  useEffect(() => {
    setRulePrompt(null);
    setExpandedId(null);
  }, [accountFilter, categoryFilter, monthFilter, search]);

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
            <Button onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add transaction'}</Button>
            <Button variant="ghost" onClick={() => { setSearch(''); setAccountFilter('all'); setCategoryFilter('all'); setMonthFilter('all'); }}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {adding && (
        <Card title="Add transaction" subtitle="cash or missed entries — fully editable later">
          <AddTransactionForm
            accounts={fixtures.accounts.filter((a) =>
              ['cash', 'chequing', 'savings', 'credit_card'].includes(a.kind),
            )}
            categories={fixtures.categories}
            onSubmit={async (b) => {
              await addTransaction(b);
              setAdding(false);
            }}
          />
        </Card>
      )}

      <Card title={`${rows.length} transactions`} subtitle={rows.length === 500 ? 'showing first 500' : undefined}>
        {rulePrompt && (
          <div className="mb-3 flex items-center gap-2 text-xs text-ink-dim">
            <span>
              Always categorize “{rulePrompt.merchant}” as {catById.get(rulePrompt.categoryId)?.name ?? rulePrompt.categoryId}?
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                void addRule({ keyword: rulePrompt.merchant, categoryId: rulePrompt.categoryId });
                setRulePrompt(null);
              }}
            >
              Create rule
            </Button>
            <Button variant="ghost" onClick={() => setRulePrompt(null)}>Dismiss</Button>
          </div>
        )}
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
                  <Fragment key={t.id}>
                  <tr className="hover:bg-bg-hover">
                    <td className="py-2 pr-4 text-ink-muted whitespace-nowrap">{formatDate(t.date)}</td>
                    <td
                      className="py-2 pr-4 text-ink cursor-pointer"
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    >
                      <div className="flex items-center gap-2">
                        {t.merchant}
                        {t.source === 'manual' && <Badge tone="info">manual</Badge>}
                      </div>
                      <div className="text-xs text-ink-dim truncate max-w-[220px]">{t.rawMerchant}</div>
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        value={t.categoryId}
                        onChange={(e) => {
                          void reclassify(t.id, e.target.value);
                          setRulePrompt({ txId: t.id, merchant: t.merchant, categoryId: e.target.value });
                        }}
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
                  {expandedId === t.id && (
                    <tr className="bg-bg-elev/50">
                      <td colSpan={5} className="py-3 px-4">
                        <TxEditor
                          tx={t}
                          accounts={fixtures.accounts.filter((a) =>
                            ['cash', 'chequing', 'savings', 'credit_card'].includes(a.kind),
                          )}
                          onSave={async (patch) => {
                            await editTransaction(t.id, patch);
                            setExpandedId(null);
                          }}
                          onDelete={
                            t.source === 'manual'
                              ? async () => {
                                  await removeTransaction(t.id);
                                  setExpandedId(null);
                                }
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function TxEditor({
  tx,
  accounts,
  onSave,
  onDelete,
}: {
  tx: import('../types').Transaction;
  accounts: { id: string; name: string }[];
  onSave: (patch: import('../data/api').TransactionPatchInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const manual = tx.source === 'manual';
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [tags, setTags] = useState((tx.tags ?? []).join(', '));
  const [isTransfer, setIsTransfer] = useState(tx.isTransfer ?? false);
  const [isDuplicate, setIsDuplicate] = useState(tx.isDuplicate ?? false);
  const [date, setDate] = useState(tx.date);
  const [merchant, setMerchant] = useState(tx.merchant);
  const [amount, setAmount] = useState(String(tx.amount));
  const [accountId, setAccountId] = useState(tx.accountId);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const inputClass = 'bg-bg-elev border border-line rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-brand';
  const amountNum = Number(amount);
  const factsValid = !manual || (date.length === 10 && merchant.trim() !== '' && Number.isFinite(amountNum) && amountNum !== 0);

  return (
    <div className="space-y-3">
      {manual && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-ink-muted">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Merchant
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={`${inputClass} w-48`} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} w-24 text-right num`} />
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 text-ink-muted">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} w-56`} />
        </label>
        <label className="flex items-center gap-2 text-ink-muted">
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" className={`${inputClass} w-48`} />
        </label>
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />
          Transfer
        </label>
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" checked={isDuplicate} onChange={(e) => setIsDuplicate(e.target.checked)} />
          Duplicate
        </label>
        <Button
          disabled={busy || !factsValid}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                notes,
                tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
                isTransfer,
                isDuplicate,
                ...(manual
                  ? { date, merchant: merchant.trim(), amount: amountNum, accountId }
                  : {}),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {onDelete &&
          (confirmingDelete ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-down">Delete this entry?</span>
              <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>
                Yes, delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </span>
          ) : (
            <button className="text-down text-xs" onClick={() => setConfirmingDelete(true)}>Delete</button>
          ))}
      </div>
    </div>
  );
}

function AddTransactionForm({
  accounts,
  categories,
  onSubmit,
}: {
  accounts: { id: string; name: string; kind: string }[];
  categories: { id: string; name: string }[];
  onSubmit: (b: import('../data/api').TransactionCreateInput) => Promise<void>;
}) {
  const cashId = accounts.find((a) => a.kind === 'cash')?.id ?? accounts[0]?.id ?? '';
  const [accountId, setAccountId] = useState(cashId);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState(''); // '' = Auto
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const inputClass = 'bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
  const amountNum = Number(amount);
  const valid = accountId && date && merchant.trim() && amount !== '' && Number.isFinite(amountNum) && amountNum > 0;

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Account
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Merchant
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Farmers' market" className={`${inputClass} w-52`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Amount
        <div className="flex items-center gap-1">
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'expense' | 'income')} className={inputClass}>
            <option value="expense">expense</option>
            <option value="income">income</option>
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputClass} w-24 text-right num`} />
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Category
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          <option value="">Auto</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} w-40`} />
      </label>
      <Button
        disabled={!valid || busy}
        onClick={async () => {
          setError('');
          setBusy(true);
          try {
            await onSubmit({
              accountId, date, merchant: merchant.trim(),
              amount: direction === 'expense' ? -Math.abs(amountNum) : Math.abs(amountNum),
              categoryId: categoryId || undefined,
              notes: notes.trim() || undefined,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Adding…' : 'Add'}
      </Button>
      {error && <p className="text-down text-sm w-full">{error}</p>}
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
