import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { Badge } from '../components/ui/Badge';
import type { BudgetMode } from '../types';

const modeDescriptions: Record<BudgetMode, { title: string; text: string }> = {
  envelope: {
    title: 'Envelope (rollover)',
    text: 'Each category gets a monthly cap. Unused money rolls over to next month if you toggle it on. Forgiving and matches real family rhythms.',
  },
  zero_based: {
    title: 'Zero-based',
    text: 'Every dollar of income must be assigned to a category each month. The "unassigned" counter should reach zero. Tightest control, most upkeep.',
  },
  fifty_thirty_twenty: {
    title: '50/30/20',
    text: '50% Needs, 30% Wants, 20% Savings. Lightweight — a quick health check rather than per-category caps.',
  },
};

export function Settings() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const budgetMode = useAppStore((s) => s.budgetMode);
  const setBudgetMode = useAppStore((s) => s.setBudgetMode);

  return (
    <div className="space-y-6">
      <Card title="Household" subtitle="Who the money belongs to">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {fixtures.household.map((p) => (
            <div key={p.id} className="bg-bg-elev border border-line rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-ink font-medium">{p.name}</div>
                <Badge tone={p.role === 'adult' ? 'info' : 'positive'}>
                  {p.role}
                </Badge>
              </div>
              {p.birthYear && <div className="text-xs text-ink-dim mt-1">Born {p.birthYear}</div>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Budget mode" subtitle="Switchable any time">
        <Tabs
          tabs={[
            { id: 'envelope', label: 'Envelope' },
            { id: 'zero_based', label: 'Zero-based' },
            { id: 'fifty_thirty_twenty', label: '50/30/20' },
          ]}
          active={budgetMode}
          onChange={(id) => setBudgetMode(id as BudgetMode)}
        />
        <div className="mt-4">
          <div className="text-sm font-medium text-ink">{modeDescriptions[budgetMode].title}</div>
          <div className="text-sm text-ink-muted mt-1">{modeDescriptions[budgetMode].text}</div>
        </div>
      </Card>

      <Card title="Currency & locale">
        <div className="text-sm text-ink-muted">
          Locked to <span className="text-ink font-medium">CAD</span> / <span className="text-ink font-medium">en-CA</span>{' '}
          in Milestone 1. Multi-currency is out of scope until the FastAPI backend lands.
        </div>
      </Card>

      <Card title="Categories" subtitle={`${fixtures.categories.length} categories · ${fixtures.rules.length} rules`}>
        <div className="flex flex-wrap gap-2">
          {fixtures.categories.map((c) => (
            <span key={c.id} className="text-xs px-2 py-1 rounded bg-bg-elev border border-line text-ink-muted">
              {c.name}
            </span>
          ))}
        </div>
      </Card>

      <Card title="About this mock">
        <div className="text-sm text-ink-muted space-y-1">
          <div>Seed: <span className="num text-ink">{fixtures.meta.seed}</span></div>
          <div>Months covered: <span className="num text-ink">{fixtures.meta.monthsCovered}</span></div>
          <div>Generated: <span className="num text-ink">{fixtures.meta.generatedAt}</span></div>
        </div>
      </Card>
    </div>
  );
}
