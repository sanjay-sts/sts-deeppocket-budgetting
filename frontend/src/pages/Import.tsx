import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { AccountForm } from '../components/shared/AccountForm';
import { errorMessage } from '../data/api';
import { cad } from '../lib/format';
import type { CsvMapping, CsvPreview, ImportSummary, TxImportSummary } from '../data/api';
import type { AccountKind } from '../types';

export function Import() {
  return (
    <div className="space-y-6">
      <InvestmentsImportCard />
      <TransactionsImportCard />
      <MappingWizardCard />
    </div>
  );
}

/**
 * Offers to create each account the CSV named but that doesn't exist, then re-runs the
 * import — so an unrecognised account is fixed in place instead of by editing the file.
 */
function UnknownAccountsCallout({
  summary, onRetry,
}: {
  summary: TxImportSummary;
  onRetry: () => Promise<void>;
}) {
  const fixtures = useAppStore((s) => s.fixtures);
  const addAccount = useAppStore((s) => s.addAccount);
  const [creating, setCreating] = useState<string | null>(null);

  if (!summary.unknownAccounts.length || !fixtures) return null;

  const institutions = [...new Set(fixtures.accounts.map((a) => a.institution))].sort();
  // A credit-card file's missing account is a credit card; anything else is a guess, so
  // default to chequing and let the user change it.
  const kind: AccountKind = summary.format === 'credit_card' ? 'credit_card' : 'chequing';

  return (
    <div className="mt-3 border border-line rounded-lg p-3 bg-bg-elev">
      <p className="text-sm text-ink">
        {summary.unknownAccounts.length === 1
          ? 'One account named in this file doesn’t exist yet.'
          : `${summary.unknownAccounts.length} accounts named in this file don’t exist yet.`}
        {' '}Create it and the skipped rows will import.
      </p>
      <ul className="mt-2 space-y-2">
        {summary.unknownAccounts.map((label) => (
          <li key={label}>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs text-ink-muted">{label}</code>
              <Button variant="secondary" onClick={() => setCreating(creating === label ? null : label)}>
                {creating === label ? 'Cancel' : 'Create account'}
              </Button>
            </div>
            {creating === label && (
              <div className="mt-2">
                <AccountForm
                  people={fixtures.household}
                  institutions={institutions}
                  defaultKind={kind}
                  // Named exactly as the CSV names it, so the retry resolves by name.
                  defaultName={label}
                  submitLabel="Create and import"
                  onCancel={() => setCreating(null)}
                  onSubmit={async (input) => {
                    await addAccount(input);
                    setCreating(null);
                    await onRetry();
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Row errors, with identical reasons collapsed.
 *
 * One bad account name in a 400-row export produced 400 identical lines, which buried the
 * few errors that differed. Grouping keeps the row numbers (the first few, so a row is
 * still findable) without repeating the reason.
 */
function ImportErrors({ errors }: { errors: { row: number; reason: string }[] }) {
  if (!errors.length) return null;

  const groups = new Map<string, number[]>();
  for (const e of errors) {
    const rows = groups.get(e.reason);
    if (rows) rows.push(e.row);
    else groups.set(e.reason, [e.row]);
  }

  return (
    <ul className="mt-2 text-down list-disc pl-5">
      {[...groups].map(([reason, rows]) => (
        <li key={reason}>
          {rows.length === 1
            ? `Row ${rows[0]}`
            : `${rows.length} rows (${rows.slice(0, 3).join(', ')}${rows.length > 3 ? ', …' : ''})`}
          : {reason}
        </li>
      ))}
    </ul>
  );
}

/** Opening balances the import worked out from a running-total column, plus any drift. */
function BalanceNotes({ summary }: { summary: TxImportSummary }) {
  const fixtures = useAppStore((s) => s.fixtures);
  const nameOf = (id: string) => fixtures?.accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      {summary.openingBalances.map((b) => (
        <p key={`ob-${b.accountId}`} className="text-xs text-ink-dim mt-1">
          Opening balance for {nameOf(b.accountId)} set to {cad(b.openingBalance, true)} from the
          statement&rsquo;s running total (was {cad(b.previousOpeningBalance, true)}).
        </p>
      ))}
      {summary.reconciliation.map((b) => (
        <p key={`rec-${b.accountId}`} className="text-down text-xs mt-1">
          {nameOf(b.accountId)} doesn&rsquo;t fully reconcile: {b.unreconciledDates}{' '}
          statement {b.unreconciledDates === 1 ? 'date' : 'dates'} can&rsquo;t be squared with the
          transactions on record, the largest gap being {cad(Math.abs(b.drift), true)}. Some
          history is probably missing — check for a statement you haven&rsquo;t imported, or for
          repeated identical rows that were skipped as duplicates.
        </p>
      ))}
    </>
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
      setError(errorMessage(e));
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
          <ImportErrors errors={summary.errors} />
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
      setError(errorMessage(e));
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
        The <code>account</code> column can be an account&rsquo;s id or its name. Re-importing the same rows is
        safe — duplicates are skipped. No header row? Use the column-mapping wizard below.
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
          <BalanceNotes summary={summary} />
          <UnknownAccountsCallout summary={summary} onRetry={run} />
          <ImportErrors errors={summary.errors} />
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
  const [runningTotalColumn, setRunningTotalColumn] = useState('');
  // Guessed by the preview and echoed back on import, so the columns line up either way.
  const [headerless, setHeaderless] = useState(false);

  const selectClass = 'bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand';

  function guess(headers: string[], candidates: string[]): string {
    const lower = headers.map((h) => h.toLowerCase());
    for (const c of candidates) {
      const i = lower.findIndex((h) => h.includes(c));
      if (i >= 0) return headers[i]!;
    }
    return '';
  }

  // A headerless file has no words to match on, so guess by position instead. The two shapes
  // real bank exports ship in are date/description/debit/credit/balance and the same without
  // a description; both end with the running total.
  function guessPositional(headers: string[]) {
    const last = headers[headers.length - 1] ?? '';
    setDateColumn(headers[0] ?? '');
    setAmountMode('split');
    setAmountColumn('');
    if (headers.length >= 5) {
      setMerchantColumn(headers[1] ?? '');
      setDebitColumn(headers[2] ?? '');
      setCreditColumn(headers[3] ?? '');
    } else {
      setMerchantColumn('');
      setDebitColumn(headers[1] ?? '');
      setCreditColumn(headers[2] ?? '');
    }
    setRunningTotalColumn(last);
    setAccountMode('fixed');
    setAccountColumn('');
  }

  async function loadPreview(f: File, headerlessOverride?: boolean) {
    setError(''); setSummary(null); setCols(null); setBusy(true);
    try {
      const p = await preview(f, headerlessOverride);
      setCols(p);
      setHeaderless(p.headerless);
      if (p.headerless) {
        guessPositional(p.headers);
      } else {
        // Pre-fill best guesses so the common case is one click.
        setDateColumn(guess(p.headers, ['date', 'posted', 'when']));
        setMerchantColumn(guess(p.headers, ['desc', 'merchant', 'detail', 'payee', 'name']));
        setAmountColumn(guess(p.headers, ['amount', 'value']));
        setDebitColumn(guess(p.headers, ['debit', 'withdrawal', 'spent']));
        setCreditColumn(guess(p.headers, ['credit', 'deposit', 'incoming']));
        setAccountColumn(guess(p.headers, ['account', 'acct']));
        setRunningTotalColumn(guess(p.headers, ['running', 'balance']));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    const mapping: CsvMapping = {
      dateColumn, dayFirst, headerless,
      merchantColumn: merchantColumn || undefined,
      runningTotalColumn: runningTotalColumn || undefined,
      ...(amountMode === 'single'
        ? { amountColumn, amountInvert }
        : { debitColumn: debitColumn || undefined, creditColumn: creditColumn || undefined }),
      ...(accountMode === 'column' ? { accountColumn } : { accountId }),
    };
    setError(''); setSummary(null); setBusy(true);
    try {
      setSummary(await importMapped(file, mapping));
    } catch (e) {
      setError(errorMessage(e));
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
        For bank exports the auto-detector doesn&rsquo;t recognise, including files with{' '}
        <strong>no header row</strong> — those are read positionally as <code>col1…colN</code>.
        Pick a file, then map its columns to date / amount / account. A description column is
        optional. Re-importing the same rows is safe — duplicates are skipped.
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
              Merchant column <span className="text-ink-dim">(optional)</span>
              <select value={merchantColumn} onChange={(e) => setMerchantColumn(e.target.value)} className={selectClass}>{headerOptions('No description column')}</select>
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
                <select value={accountColumn} onChange={(e) => setAccountColumn(e.target.value)} className={selectClass}>{headerOptions('Account id or name column')}</select>
              )}
            </div>

            <label className="flex flex-col gap-1 text-xs text-ink-dim">
              Running-total column <span className="text-ink-dim">(optional)</span>
              <select value={runningTotalColumn} onChange={(e) => setRunningTotalColumn(e.target.value)} className={selectClass}>{headerOptions('None')}</select>
              <span className="text-ink-dim">
                The statement&rsquo;s balance after each transaction. Map it and the opening balance
                is worked out for you.
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} /> Dates are day-first (DD/MM/YYYY)
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={headerless}
                // Re-reads the file, because which row is data depends on this.
                onChange={(e) => file && void loadPreview(file, e.target.checked)}
              /> No header row
            </label>
            <Button
              className="ml-auto"
              onClick={run}
              disabled={busy || !dateColumn ||
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
          <BalanceNotes summary={summary} />
          <UnknownAccountsCallout summary={summary} onRetry={run} />
          <ImportErrors errors={summary.errors} />
        </div>
      )}
    </Card>
  );
}
