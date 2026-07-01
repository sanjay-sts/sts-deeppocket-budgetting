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
      <table className="w-full text-sm mb-3 table-fixed">
        <thead><tr className="text-left text-xs text-ink-dim uppercase tracking-wider"><th className="py-1 pr-3 w-2/5">Name</th><th className="py-1 pr-3 w-1/5">Role</th><th className="py-1 pr-3 w-1/5">Birth year</th><th className="w-1/5"></th></tr></thead>
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
          <tr className="border-t border-line">
            <td className="pt-2 pr-3">
              <input className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </td>
            <td className="pt-2 pr-3">
              <select className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={role} onChange={(e) => setRole(e.target.value as 'adult' | 'child')}>
                <option value="adult">adult</option>
                <option value="child">child</option>
              </select>
            </td>
            <td className="pt-2 pr-3">
              <input className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Birth year" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
            </td>
            <td className="pt-2 text-right align-bottom">
              <Button onClick={submit} disabled={!name}>Add member</Button>
            </td>
          </tr>
        </tbody>
      </table>
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
  const institutionOptions = [...new Set(accounts.map((a) => a.institution))].sort();
  const [form, setForm] = useState({ personIds: [] as string[], institution: '', accountType: '', beneficiaryIds: [] as string[] });
  const [error, setError] = useState('');

  function toggleOwner(id: string) {
    setForm((f) => ({
      ...f,
      personIds: f.personIds.includes(id) ? f.personIds.filter((x) => x !== id) : [...f.personIds, id],
    }));
  }

  function toggleBeneficiary(id: string) {
    setForm((f) => ({
      ...f,
      beneficiaryIds: f.beneficiaryIds.includes(id) ? f.beneficiaryIds.filter((x) => x !== id) : [...f.beneficiaryIds, id],
    }));
  }

  async function submit() {
    setError('');
    try {
      await addAccount({
        personIds: form.personIds, institution: form.institution, accountType: form.accountType,
        beneficiaryIds: form.beneficiaryIds.length ? form.beneficiaryIds : undefined,
      });
      setForm({ personIds: [], institution: '', accountType: '', beneficiaryIds: [] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">Investment accounts</h2>
      <table className="w-full text-sm mb-3 table-fixed">
        <thead>
          <tr className="text-left text-xs text-ink-dim uppercase tracking-wider">
            <th className="py-1 pr-3 w-[16%]">Owner</th>
            <th className="py-1 pr-3 w-[18%]">Institution</th>
            <th className="py-1 pr-3 w-[18%]">Account type</th>
            <th className="py-1 pr-3 w-[14%]">Kind</th>
            <th className="py-1 pr-3 w-[18%]">RESP beneficiary</th>
            <th className="w-[16%]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {accounts.map((a) => (
            <tr key={a.id} className="border-t border-line">
              <td className="py-1.5 pr-3 text-ink-muted">{a.ownerIds.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—'}</td>
              <td className="py-1.5 pr-3 text-ink">{a.institution}</td>
              <td className="py-1.5 pr-3 text-ink">{a.accountType ?? '—'}</td>
              <td className="py-1.5 pr-3 text-ink-muted">{a.kind}</td>
              <td className="py-1.5 pr-3 text-ink-muted">{(a.beneficiaryIds ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—'}</td>
              <td className="text-right">
                <button className="text-down" onClick={async () => {
                  setError('');
                  try { await removeAccount(a.id); } catch (e) { setError((e as Error).message); }
                }}>Remove</button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="pt-2 pr-3">
              <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={form.personIds.includes(p.id)}
                      onChange={() => toggleOwner(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </td>
            <td className="pt-2 pr-3">
              <input
                className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand"
                placeholder="Institution"
                list="institution-options"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
              <datalist id="institution-options">
                {institutionOptions.map((inst) => <option key={inst} value={inst} />)}
              </datalist>
            </td>
            <td className="pt-2 pr-3">
              <input className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="e.g. tfsa, dccp2" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} />
            </td>
            <td className="pt-2 pr-3 text-xs text-ink-dim italic">auto</td>
            <td className="pt-2 pr-3">
              <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
                {kids.map((k) => (
                  <label key={k.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={form.beneficiaryIds.includes(k.id)}
                      onChange={() => toggleBeneficiary(k.id)}
                    />
                    {k.name}
                  </label>
                ))}
              </div>
            </td>
            <td className="pt-2 text-right align-bottom">
              <Button onClick={submit} disabled={!form.personIds.length || !form.institution || !form.accountType}>Add account</Button>
            </td>
          </tr>
        </tbody>
      </table>
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
