import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/Tabs';
import { Badge } from '../components/ui/Badge';
import type { BudgetMode } from '../types';

function HouseholdSection() {
  const household = useAppStore((s) => s.fixtures?.household ?? []);
  const addPerson = useAppStore((s) => s.addPerson);
  const removePerson = useAppStore((s) => s.removePerson);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'adult' | 'child'>('adult');
  const [birthYear, setBirthYear] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await addPerson({ name, role, birthYear: birthYear ? Number(birthYear) : undefined });
      setName(''); setBirthYear('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">Household</h2>
      <table className="w-full text-sm mb-3">
        <thead><tr className="text-left text-xs text-ink-dim uppercase tracking-wider"><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Role</th><th className="py-1 pr-3">Birth year</th><th></th></tr></thead>
        <tbody className="divide-y divide-line">
          {household.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="py-1.5 pr-3 text-ink">{p.name}</td><td className="py-1.5 pr-3 text-ink-muted">{p.role}</td><td className="py-1.5 pr-3 text-ink-muted">{p.birthYear ?? '—'}</td>
              <td className="text-right">
                <button className="text-down" onClick={async () => {
                  setError('');
                  try { await removePerson(p.id); } catch (e) { setError((e as Error).message); }
                }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 items-end">
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={role} onChange={(e) => setRole(e.target.value as 'adult' | 'child')}>
          <option value="adult">adult</option>
          <option value="child">child</option>
        </select>
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-28" placeholder="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
        <Button onClick={submit} disabled={!name}>Add member</Button>
      </div>
      {error && <p className="text-down text-sm mt-2">{error}</p>}
    </Card>
  );
}

const INVESTMENT_KINDS = ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'non_registered', 'crypto'];

function InvestmentAccountsSection() {
  const fixtures = useAppStore((s) => s.fixtures);
  const addAccount = useAppStore((s) => s.addAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const people = fixtures?.household ?? [];
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
  const kids = people.filter((p) => p.role === 'child');
  const [form, setForm] = useState({ personId: '', institution: '', accountType: '', beneficiaryId: '' });
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await addAccount({
        personId: form.personId, institution: form.institution, accountType: form.accountType,
        beneficiaryId: form.beneficiaryId || undefined,
      });
      setForm({ personId: '', institution: '', accountType: '', beneficiaryId: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">Investment accounts</h2>
      <table className="w-full text-sm mb-3">
        <thead><tr className="text-left text-xs text-ink-dim uppercase tracking-wider"><th className="py-1 pr-3">Owner</th><th className="py-1 pr-3">Institution</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Kind</th><th></th></tr></thead>
        <tbody className="divide-y divide-line">
          {accounts.map((a) => (
            <tr key={a.id} className="border-t border-line">
              <td className="py-1.5 pr-3 text-ink-muted">{people.find((p) => p.id === a.ownerIds[0])?.name ?? '—'}</td>
              <td className="py-1.5 pr-3 text-ink">{a.institution}</td><td className="py-1.5 pr-3 text-ink">{a.name}</td><td className="py-1.5 pr-3 text-ink-muted">{a.kind}</td>
              <td className="text-right">
                <button className="text-down" onClick={async () => {
                  setError('');
                  try { await removeAccount(a.id); } catch (e) { setError((e as Error).message); }
                }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 items-end flex-wrap">
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })}>
          <option value="">Owner…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Institution" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Account type (e.g. tfsa, dccp2)" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} />
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={form.beneficiaryId} onChange={(e) => setForm({ ...form, beneficiaryId: e.target.value })}>
          <option value="">RESP beneficiary (optional)…</option>
          {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <Button onClick={submit} disabled={!form.personId || !form.institution || !form.accountType}>Add account</Button>
      </div>
      {error && <p className="text-down text-sm mt-2">{error}</p>}
    </Card>
  );
}

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

      <HouseholdSection />

      <InvestmentAccountsSection />

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
