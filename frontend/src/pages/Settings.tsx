import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Tabs } from '../components/ui/Tabs';
import { Badge } from '../components/ui/Badge';
import { ConfirmDeleteModal } from '../components/shared/ConfirmDeleteModal';
import { autoName } from '../lib/account';
import type { BudgetMode } from '../types';

function HouseholdSection() {
  const household = useAppStore((s) => s.fixtures?.household ?? []);
  const addPerson = useAppStore((s) => s.addPerson);
  const removePerson = useAppStore((s) => s.removePerson);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'adult' | 'child'>('adult');
  const [birthYear, setBirthYear] = useState('');
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pendingPerson = household.find((p) => p.id === pendingDelete) ?? null;

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
                <button className="text-down" onClick={() => setPendingDelete(p.id)}>Remove</button>
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
      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={`Remove ${pendingPerson?.name ?? 'this person'}?`}
        description="This will permanently delete this household member."
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await removePerson(pendingDelete);
          setPendingDelete(null);
        }}
        onForceConfirm={async () => {
          if (!pendingDelete) return;
          await removePerson(pendingDelete, true);
          setPendingDelete(null);
        }}
      />
    </Card>
  );
}

const INVESTMENT_KINDS = ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'non_registered', 'crypto'];

function InvestmentAccountsSection() {
  const fixtures = useAppStore((s) => s.fixtures);
  const addAccount = useAppStore((s) => s.addAccount);
  const editAccount = useAppStore((s) => s.editAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const people = fixtures?.household ?? [];
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
  const kids = people.filter((p) => p.role === 'child');
  const ownerOptions = people.map((p) => ({ id: p.id, label: p.name }));
  const kidOptions = kids.map((k) => ({ id: k.id, label: k.name }));
  const institutionOptions = [...new Set(accounts.map((a) => a.institution))].sort();
  const inputClass = 'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
  // Beneficiaries only apply to RESP accounts, so the picker is shown RESP-only.
  const isResp = (t: string) => t.trim().toLowerCase() === 'resp';
  const [form, setForm] = useState({ name: '', personIds: [] as string[], institution: '', accountType: '', beneficiaryIds: [] as string[] });
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', personIds: [] as string[], institution: '', accountType: '', beneficiaryIds: [] as string[] });
  const pendingAccount = accounts.find((a) => a.id === pendingDelete) ?? null;

  async function saveEdit(id: string) {
    setError('');
    try {
      await editAccount(id, {
        name: draft.name, personIds: draft.personIds, institution: draft.institution,
        accountType: draft.accountType, beneficiaryIds: draft.beneficiaryIds,
      });
      setEditingId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    setError('');
    try {
      await addAccount({
        name: form.name || undefined,
        personIds: form.personIds, institution: form.institution, accountType: form.accountType,
        beneficiaryIds: form.beneficiaryIds.length ? form.beneficiaryIds : undefined,
      });
      setForm({ name: '', personIds: [], institution: '', accountType: '', beneficiaryIds: [] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">Investment accounts</h2>
      <table className="w-full text-sm mb-2 table-fixed">
        <thead>
          <tr className="text-left text-xs text-ink-dim uppercase tracking-wider">
            <th className="py-1 pr-3 w-[22%]">Name</th>
            <th className="py-1 pr-3 w-[16%]">Owner</th>
            <th className="py-1 pr-3 w-[18%]">Institution</th>
            <th className="py-1 pr-3 w-[14%]">Account type</th>
            <th className="py-1 pr-3 w-[14%]">Beneficiary</th>
            <th className="w-[16%]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {accounts.map((a) => (
            editingId === a.id ? (
              <tr key={a.id} className="border-t border-line">
                <td className="py-1.5 pr-3 align-top">
                  <input className={inputClass} placeholder={autoName(draft.personIds, draft.institution, draft.accountType, people) || 'Auto name'} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </td>
                <td className="py-1.5 pr-3 align-top">
                  <MultiSelect options={ownerOptions} selected={draft.personIds} onChange={(ids) => setDraft({ ...draft, personIds: ids })} placeholder="Owner" />
                </td>
                <td className="py-1.5 pr-3 align-top">
                  <input className={inputClass} list="institution-options" placeholder="Institution — e.g. WealthSimple, Questrade, TD" value={draft.institution} onChange={(e) => setDraft({ ...draft, institution: e.target.value })} />
                </td>
                <td className="py-1.5 pr-3 align-top">
                  <input className={inputClass} placeholder="Account type — e.g. tfsa, rrsp, resp, fhsa" value={draft.accountType} onChange={(e) => setDraft({ ...draft, accountType: e.target.value })} />
                </td>
                <td className="py-1.5 pr-3 align-top">
                  {isResp(draft.accountType)
                    ? <MultiSelect options={kidOptions} selected={draft.beneficiaryIds} onChange={(ids) => setDraft({ ...draft, beneficiaryIds: ids })} placeholder="Beneficiary" />
                    : <span className="text-ink-dim">—</span>}
                </td>
                <td className="text-right whitespace-nowrap align-top">
                  <Button onClick={() => saveEdit(a.id)} disabled={draft.personIds.length === 0}>Save</Button>
                  <button className="text-ink-muted hover:text-ink ml-2" onClick={() => { setEditingId(null); setError(''); }}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={a.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink">{a.name}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{a.ownerIds.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—'}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{a.institution}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{a.accountType ?? '—'}</td>
                <td className="py-1.5 pr-3 text-ink-muted">
                  {a.kind === 'resp'
                    ? ((a.beneficiaryIds ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—')
                    : <span className="text-ink-dim">—</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  <button className="text-ink-muted hover:text-ink" onClick={() => { setDraft({ name: a.customName ?? '', personIds: a.ownerIds, institution: a.institution, accountType: a.accountType ?? '', beneficiaryIds: a.beneficiaryIds ?? [] }); setEditingId(a.id); setError(''); }}>Edit</button>
                  <button className="text-down ml-2" onClick={() => setPendingDelete(a.id)}>Remove</button>
                </td>
              </tr>
            )
          ))}
          <tr className="border-t border-line">
            <td className="pt-2 pr-3 align-top">
              <input
                className={inputClass}
                placeholder={autoName(form.personIds, form.institution, form.accountType, people) || 'Name (optional)'}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </td>
            <td className="pt-2 pr-3 align-top">
              <MultiSelect options={ownerOptions} selected={form.personIds} onChange={(ids) => setForm({ ...form, personIds: ids })} placeholder="Owner" />
            </td>
            <td className="pt-2 pr-3 align-top">
              <input
                className={inputClass}
                placeholder="Institution — e.g. WealthSimple, Questrade, TD"
                list="institution-options"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
              <datalist id="institution-options">
                {institutionOptions.map((inst) => <option key={inst} value={inst} />)}
              </datalist>
            </td>
            <td className="pt-2 pr-3 align-top">
              <input className={inputClass} placeholder="Account type — e.g. tfsa, rrsp, resp, fhsa" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} />
            </td>
            <td className="pt-2 pr-3 align-top">
              {isResp(form.accountType)
                ? <MultiSelect options={kidOptions} selected={form.beneficiaryIds} onChange={(ids) => setForm({ ...form, beneficiaryIds: ids })} placeholder="Beneficiary" />
                : <span className="text-ink-dim text-xs">RESP accounts only</span>}
            </td>
            <td className="pt-2 text-right align-top">
              <Button onClick={submit} disabled={!form.personIds.length || !form.institution || !form.accountType}>Add account</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-ink-dim mb-3">
        Recognized account types: tfsa, rrsp, resp, fhsa, dcpp, non_registered, crypto.
      </p>
      {error && <p className="text-down text-sm mt-2">{error}</p>}
      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={`Remove ${pendingAccount?.institution ?? 'this account'}?`}
        description="This will permanently delete this investment account."
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await removeAccount(pendingDelete);
          setPendingDelete(null);
        }}
        onForceConfirm={async () => {
          if (!pendingDelete) return;
          await removeAccount(pendingDelete, true);
          setPendingDelete(null);
        }}
      />
    </Card>
  );
}

// The three irreversible bulk actions in the danger zone. Each is gated behind a distinct
// type-to-confirm phrase so the buttons can never be mis-fired for one another.
type PurgeMode = import('../data/api').PurgeMode;
const DANGER_ACTIONS: {
  mode: PurgeMode;
  button: string;
  phrase: string;
  title: string;
  description: string;
}[] = [
  {
    mode: 'investments',
    button: 'Clear investment data',
    phrase: 'CLEAR',
    title: 'Clear all investment data?',
    description:
      'This permanently deletes every investment account, snapshot, and contribution. Your household members are kept. This cannot be undone.',
  },
  {
    mode: 'all',
    button: 'Clear everything',
    phrase: 'ERASE',
    title: 'Clear everything?',
    description:
      'This permanently deletes all household members, accounts, snapshots, and contributions — everything editable. This cannot be undone.',
  },
  {
    mode: 'demo',
    button: 'Reset to demo data',
    phrase: 'RESET',
    title: 'Reset to demo data?',
    description:
      'This wipes your current household and investment data, then restores the built-in demo dataset in its place.',
  },
];

function DangerZone() {
  const purgeData = useAppStore((s) => s.purgeData);
  const [pending, setPending] = useState<PurgeMode | null>(null);
  const active = DANGER_ACTIONS.find((a) => a.mode === pending) ?? null;

  return (
    <Card className="border-down">
      <h2 className="text-lg font-semibold text-down mb-1">Danger zone</h2>
      <p className="text-ink-muted text-sm mb-4">
        Irreversible bulk actions. Each asks you to type a keyword to confirm.
      </p>
      <div className="flex flex-wrap gap-2">
        {DANGER_ACTIONS.map((a) => (
          <button
            key={a.mode}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors border border-down text-down hover:bg-down hover:text-bg"
            onClick={() => setPending(a.mode)}
          >
            {a.button}
          </button>
        ))}
      </div>
      {active && (
        <ConfirmDeleteModal
          open={pending !== null}
          title={active.title}
          description={active.description}
          confirmLabel={active.button}
          confirmPhrase={active.phrase}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await purgeData(active.mode);
            setPending(null);
          }}
        />
      )}
    </Card>
  );
}

export function RulesSection() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const rules = useAppStore((s) => s.rules);
  const loadRules = useAppStore((s) => s.loadRules);
  const addRule = useAppStore((s) => s.addRule);
  const editRule = useAppStore((s) => s.editRule);
  const removeRule = useAppStore((s) => s.removeRule);

  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState(fixtures.categories[0]?.id ?? '');
  const [error, setError] = useState('');

  useEffect(() => { void loadRules(); }, [loadRules]);

  const catById = new Map(fixtures.categories.map((c) => [c.id, c]));

  async function submit() {
    setError('');
    try {
      await addRule({ keyword, categoryId });
      setKeyword('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="keyword, e.g. costco"
          className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-48"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="bg-bg-elev border border-line rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
        >
          {fixtures.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button onClick={() => void submit()} disabled={!keyword.trim()}>Add rule</Button>
      </div>
      {error && <p className="text-down text-sm">{error}</p>}
      {rules.length === 0 ? (
        <p className="text-sm text-ink-dim">No rules yet — reclassify a transaction and choose “Create rule”, or add one above.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="py-2 text-ink">{r.keyword}</td>
                <td className="py-2">
                  <select
                    value={r.categoryId}
                    onChange={(e) => void editRule(r.id, { categoryId: e.target.value })}
                    className="bg-transparent border-0 text-xs focus:outline-none cursor-pointer text-ink-muted hover:text-ink"
                  >
                    {fixtures.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right text-xs text-ink-dim">{catById.get(r.categoryId)?.group}</td>
                <td className="py-2 text-right">
                  <Button variant="ghost" onClick={() => void removeRule(r.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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

      <Card title="Categories" subtitle={`${fixtures.categories.length} categories`}>
        <div className="flex flex-wrap gap-2">
          {fixtures.categories.map((c) => (
            <span key={c.id} className="text-xs px-2 py-1 rounded bg-bg-elev border border-line text-ink-muted">
              {c.name}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Categorization rules" subtitle="keyword → category, applied to CSV imports (newest rule wins)">
        <RulesSection />
      </Card>

      <Card title="About this mock">
        <div className="text-sm text-ink-muted space-y-1">
          <div>Seed: <span className="num text-ink">{fixtures.meta.seed}</span></div>
          <div>Months covered: <span className="num text-ink">{fixtures.meta.monthsCovered}</span></div>
          <div>Generated: <span className="num text-ink">{fixtures.meta.generatedAt}</span></div>
        </div>
      </Card>

      <DangerZone />
    </div>
  );
}
