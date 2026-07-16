import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { ImportSummary } from '../data/api';

export function Import() {
  const importCsv = useAppStore((s) => s.importCsv);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setError(''); setBusy(true); setSummary(null);
    try {
      setSummary(await importCsv(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold text-ink mb-2">Import investments CSV</h1>
      <p className="text-sm text-ink-dim mb-3">
        Columns: <code>date, person, institution, account_type, amount</code>.
        Dates may be <code>YYYYMMDD</code> or <code>YYYY-MM-DD</code>. Missing people/accounts are created automatically.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input type="file" accept=".csv,text/csv" className="text-sm text-ink-muted" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button onClick={run} disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
      {error && <p className="text-down text-sm">{error}</p>}
      {summary && (
        <div className="text-sm text-ink-muted">
          <p>Created {summary.created} · Updated {summary.updated} · Skipped {summary.skipped}</p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 text-down list-disc pl-5">
              {summary.errors.map((er, idx) => <li key={idx}>Row {er.row}: {er.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
