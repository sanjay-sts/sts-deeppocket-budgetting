import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { CsvMapping, CsvPreview, ImportSummary, TxImportSummary } from '../data/api';

export function Import() {
  return (
    <div className="space-y-6">
      <InvestmentsImportCard />
      <TransactionsImportCard />
      <MappingWizardCard />
    </div>
  );
}

function InvestmentsImportCard() {
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

function TransactionsImportCard() {
  const importTransactionsFile = useAppStore((s) => s.importTransactionsFile);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<TxImportSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setError(''); setBusy(true); setSummary(null);
    try {
      setSummary(await importTransactionsFile(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold text-ink mb-2">Import bank / credit-card CSV</h1>
      <p className="text-sm text-ink-dim mb-3">
        Auto-detected formats: bank (<code>Date, Transaction_detail, withdrawal, deposit, running_total, account</code>)
        or credit card (<code>Date, merchant, amount, payment, running_total, account</code>).
        The <code>account</code> column must match an existing account id. Re-importing the same rows is safe — duplicates are skipped.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input type="file" accept=".csv,text/csv" className="text-sm text-ink-muted" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button onClick={run} disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
      {error && <p className="text-down text-sm">{error}</p>}
      {summary && (
        <div className="text-sm text-ink-muted">
          <p>
            Created {summary.created} · Duplicates {summary.duplicates} · Skipped {summary.skipped}
          </p>
          <p className="text-xs text-ink-dim mt-1">
            Categorized — history {summary.categorized.history} · rules {summary.categorized.rules} · unclassified {summary.categorized.unclassified}
          </p>
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

// Column-mapping wizard: for bank exports whose headers the auto-detector doesn't know.
// Upload → preview headers/sample rows → map columns → import through the mapped endpoint.
function MappingWizardCard() {
  const accounts = useAppStore((s) => s.fixtures?.accounts ?? []);
  const preview = useAppStore((s) => s.previewTransactionsCsv);
  const importMapped = useAppStore((s) => s.importTransactionsMapped);

  const [file, setFile] = useState<File | null>(null);
  const [cols, setCols] = useState<CsvPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<TxImportSummary | null>(null);

  const [dateColumn, setDateColumn] = useState('');
  const [merchantColumn, setMerchantColumn] = useState('');
  const [amountMode, setAmountMode] = useState<'single' | 'split'>('single');
  const [amountColumn, setAmountColumn] = useState('');
  const [amountInvert, setAmountInvert] = useState(false);
  const [debitColumn, setDebitColumn] = useState('');
  const [creditColumn, setCreditColumn] = useState('');
  const [accountMode, setAccountMode] = useState<'column' | 'fixed'>('fixed');
  const [accountColumn, setAccountColumn] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [dayFirst, setDayFirst] = useState(false);

  const selectClass = 'bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand';

  function guess(headers: string[], candidates: string[]): string {
    const lower = headers.map((h) => h.toLowerCase());
    for (const c of candidates) {
      const i = lower.findIndex((h) => h.includes(c));
      if (i >= 0) return headers[i]!;
    }
    return '';
  }

  async function loadPreview(f: File) {
    setError(''); setSummary(null); setCols(null); setBusy(true);
    try {
      const p = await preview(f);
      setCols(p);
      // Pre-fill best guesses so the common case is one click.
      setDateColumn(guess(p.headers, ['date', 'posted', 'when']));
      setMerchantColumn(guess(p.headers, ['desc', 'merchant', 'detail', 'payee', 'name']));
      setAmountColumn(guess(p.headers, ['amount', 'value']));
      setDebitColumn(guess(p.headers, ['debit', 'withdrawal']));
      setCreditColumn(guess(p.headers, ['credit', 'deposit']));
      setAccountColumn(guess(p.headers, ['account', 'acct']));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    const mapping: CsvMapping = {
      dateColumn, merchantColumn, dayFirst,
      ...(amountMode === 'single'
        ? { amountColumn, amountInvert }
        : { debitColumn: debitColumn || undefined, creditColumn: creditColumn || undefined }),
      ...(accountMode === 'column' ? { accountColumn } : { accountId }),
    };
    setError(''); setSummary(null); setBusy(true);
    try {
      setSummary(await importMapped(file, mapping));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const headerOptions = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {cols?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
    </>
  );

  return (
    <Card>
      <h1 className="text-xl font-semibold text-ink mb-2">Import any CSV (column-mapping wizard)</h1>
      <p className="text-sm text-ink-dim mb-3">
        For bank exports the auto-detector doesn't recognise. Pick a file, then map its columns to
        date / merchant / amount / account. Re-importing the same rows is safe — duplicates are skipped.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm text-ink-muted"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) void loadPreview(f);
          }}
        />
        {busy && !cols && <span className="text-xs text-ink-dim">Reading…</span>}
      </div>

      {cols && (
        <>
          <div className="overflow-x-auto scrollbar-thin mb-4 border border-line rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-dim border-b border-line">
                  {cols.headers.map((h) => <th key={h} className="px-2 py-1.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cols.sampleRows.map((r, i) => (
                  <tr key={i}>
                    {cols.headers.map((h) => <td key={h} className="px-2 py-1 text-ink-muted whitespace-nowrap">{r[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-dim mb-3">{cols.rowCount} data row{cols.rowCount === 1 ? '' : 's'} in this file.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="flex flex-col gap-1 text-xs text-ink-dim">
              Date column
              <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)} className={selectClass}>{headerOptions('Choose…')}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-dim">
              Merchant column
              <select value={merchantColumn} onChange={(e) => setMerchantColumn(e.target.value)} className={selectClass}>{headerOptions('Choose…')}</select>
            </label>

            <div className="flex flex-col gap-1 text-xs text-ink-dim">
              Amount
              <div className="flex items-center gap-3 mb-1 text-ink-muted">
                <label className="flex items-center gap-1"><input type="radio" checked={amountMode === 'single'} onChange={() => setAmountMode('single')} /> Single column</label>
                <label className="flex items-center gap-1"><input type="radio" checked={amountMode === 'split'} onChange={() => setAmountMode('split')} /> Debit / credit</label>
              </div>
              {amountMode === 'single' ? (
                <div className="flex items-center gap-2">
                  <select value={amountColumn} onChange={(e) => setAmountColumn(e.target.value)} className={selectClass}>{headerOptions('Amount column')}</select>
                  <label className="flex items-center gap-1 text-ink-muted whitespace-nowrap"><input type="checkbox" checked={amountInvert} onChange={(e) => setAmountInvert(e.target.checked)} /> flip sign</label>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select value={debitColumn} onChange={(e) => setDebitColumn(e.target.value)} className={selectClass}>{headerOptions('Debit (expense)')}</select>
                  <select value={creditColumn} onChange={(e) => setCreditColumn(e.target.value)} className={selectClass}>{headerOptions('Credit (inflow)')}</select>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 text-xs text-ink-dim">
              Account
              <div className="flex items-center gap-3 mb-1 text-ink-muted">
                <label className="flex items-center gap-1"><input type="radio" checked={accountMode === 'fixed'} onChange={() => setAccountMode('fixed')} /> Fixed</label>
                <label className="flex items-center gap-1"><input type="radio" checked={accountMode === 'column'} onChange={() => setAccountMode('column')} /> From column</label>
              </div>
              {accountMode === 'fixed' ? (
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
                  <option value="">Choose account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <select value={accountColumn} onChange={(e) => setAccountColumn(e.target.value)} className={selectClass}>{headerOptions('Account-id column')}</select>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} /> Dates are day-first (DD/MM/YYYY)
            </label>
            <Button
              className="ml-auto"
              onClick={run}
              disabled={busy || !dateColumn || !merchantColumn ||
                (amountMode === 'single' ? !amountColumn : !debitColumn && !creditColumn) ||
                (accountMode === 'fixed' ? !accountId : !accountColumn)}
            >
              {busy ? 'Importing…' : 'Import with this mapping'}
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-down text-sm mt-3">{error}</p>}
      {summary && (
        <div className="text-sm text-ink-muted mt-3">
          <p>Created {summary.created} · Duplicates {summary.duplicates} · Skipped {summary.skipped}</p>
          <p className="text-xs text-ink-dim mt-1">
            Categorized — history {summary.categorized.history} · rules {summary.categorized.rules} · unclassified {summary.categorized.unclassified}
          </p>
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
