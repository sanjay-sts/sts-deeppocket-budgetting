import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { listSnapshots, type SnapshotRow } from '../../data/api';

/**
 * Add/update/delete value snapshots for a set of accounts. The Investments page scopes
 * it to investment kinds; the Properties page to property/mortgage accounts, where a
 * snapshot is the market value or the outstanding principal.
 */
export function SnapshotEditor({
  accounts,
  title = 'Add / update value',
}: {
  accounts: { id: string; name: string }[];
  title?: string;
}) {
  const saveSnapshot = useAppStore((s) => s.saveSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Snapshot rows in the consolidated fixtures payload have no stable per-row id, so this
  // editor sources its own editable/deletable list from the id-bearing endpoint. Re-runs
  // whenever the account changes, or after a successful save/delete bumps refreshKey.
  useEffect(() => {
    if (!accountId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    listSnapshots(accountId).then((data) => {
      if (!cancelled) setRows([...data].sort((a, b) => a.date.localeCompare(b.date)));
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, refreshKey]);

  async function submit() {
    setError('');
    try {
      await saveSnapshot({ accountId, date, amount: Number(amount) });
      setDate(''); setAmount('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">{title}</h2>
      <div className="flex gap-2 items-end flex-wrap mb-4">
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="date" className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand [color-scheme:dark]" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="number" step="0.01" className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-32" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button onClick={submit} disabled={!accountId || !date || !amount}>Save</Button>
      </div>
      {error && <p className="text-down text-sm mb-2">{error}</p>}
      {accountId && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-ink-dim uppercase tracking-wider"><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Amount</th><th></th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink">{s.date}</td>
                <td className="py-1.5 pr-3 text-ink num">{s.amount.toLocaleString()}</td>
                <td className="text-right"><button className="text-down" onClick={() => setPendingDelete(s.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title="Delete this snapshot?"
        description="This will permanently delete this account value snapshot."
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await removeSnapshot(pendingDelete);
          setPendingDelete(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </Card>
  );
}
