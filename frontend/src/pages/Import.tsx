import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useAppStore } from '../store/useAppStore';

export function Import() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const counts = {
    bank: fixtures.transactions.filter((t) => {
      const acc = fixtures.accounts.find((a) => a.id === t.accountId);
      return acc && (acc.kind === 'chequing' || acc.kind === 'savings');
    }).length,
    cc: fixtures.transactions.filter((t) => {
      const acc = fixtures.accounts.find((a) => a.id === t.accountId);
      return acc?.kind === 'credit_card';
    }).length,
    inv: fixtures.investments.length,
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center gap-3">
          <Badge tone="info">M1 · stub</Badge>
          <div className="text-sm text-ink-muted">
            In Milestone 2 this screen accepts real CSVs. For now it shows the fixture the mock generator produced.
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SourceCard
          title="Chequing & savings"
          schema="Date, Transaction_detail, withdrawal, deposit, running_total, account"
          file="mock/out/bank_transactions.csv"
          count={counts.bank}
          label="rows"
        />
        <SourceCard
          title="Credit card bills"
          schema="Date, merchant, amount, payment, running_total, account"
          file="mock/out/credit_card.csv"
          count={counts.cc}
          label="rows"
        />
        <SourceCard
          title="Investment snapshots"
          schema="date, person, institution, account_type, amount"
          file="mock/out/investments.csv"
          count={counts.inv}
          label="monthly rows"
        />
      </div>

      <Card title="What Milestone 2 adds">
        <ul className="text-sm text-ink-muted space-y-2 list-disc list-inside">
          <li>Drag-and-drop CSV upload with source-type picker</li>
          <li>Auto-detect columns and preview before committing</li>
          <li>Duplicate-detection (date + amount + merchant fuzzy match)</li>
          <li>Auto-categorize preview with the rules engine</li>
          <li>Commit to FastAPI backend + SQLite</li>
        </ul>
      </Card>
    </div>
  );
}

function SourceCard({
  title,
  schema,
  file,
  count,
  label,
}: {
  title: string;
  schema: string;
  file: string;
  count: number;
  label: string;
}) {
  return (
    <Card>
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="text-xs text-ink-dim mt-1 font-mono">{schema}</div>
      <div className="mt-4 num text-2xl text-ink">{count.toLocaleString('en-CA')}</div>
      <div className="text-xs text-ink-dim">{label} in {file}</div>
    </Card>
  );
}
