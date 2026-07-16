import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  LineChart,
  Line,
  YAxis,
} from 'recharts';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { cad, cadK, pct } from '../lib/format';
import { contributionRoomUsed, cesgStatusPerKid, estimateMarginalRate } from '../lib/canadian';
import { MoneyCell } from '../components/shared/MoneyCell';
import { ConfirmDeleteModal } from '../components/shared/ConfirmDeleteModal';
import { monthKey } from '../lib/format';
import { listSnapshots, type SnapshotRow } from '../data/api';
import type { AccountKind, ContributionKind } from '../types';

const KIND_COLORS: Record<AccountKind, string> = {
  chequing: '#64748b',
  savings: '#94a3b8',
  credit_card: '#f87171',
  tfsa: '#34d399',
  rrsp: '#60a5fa',
  resp: '#f472b6',
  fhsa: '#fbbf24',
  dcpp: '#c084fc',
  non_registered: '#a3e635',
  crypto: '#fb923c',
};

const KIND_LABEL: Record<AccountKind, string> = {
  chequing: 'Chequing',
  savings: 'Savings',
  credit_card: 'Credit Card',
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  resp: 'RESP',
  fhsa: 'FHSA',
  dcpp: 'DCPP',
  non_registered: 'Non-registered',
  crypto: 'Crypto',
};

export function Investments() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const limits = fixtures.craLimits;

  const accById = new Map(fixtures.accounts.map((a) => [a.id, a]));
  const personById = new Map(fixtures.household.map((p) => [p.id, p]));

  // Latest snapshot per account + per-account 6-month trend
  const { latestByAcc, trendsByAcc } = useMemo(() => {
    const latest = new Map<string, number>();
    const trends: Record<string, number[]> = {};
    const sorted = [...fixtures.investments].sort((a, b) => a.date.localeCompare(b.date));
    for (const s of sorted) {
      latest.set(s.accountId, s.amount);
      (trends[s.accountId] ??= []).push(s.amount);
    }
    return { latestByAcc: latest, trendsByAcc: trends };
  }, [fixtures.investments]);

  const lastSnapYm = useMemo(() => {
    const all = [...new Set(fixtures.investments.map((s) => monthKey(s.date)))].sort();
    return all[all.length - 1] ?? '';
  }, [fixtures.investments]);
  const prevYm = useMemo(() => {
    const all = [...new Set(fixtures.investments.map((s) => monthKey(s.date)))].sort();
    return all[all.length - 2] ?? '';
  }, [fixtures.investments]);

  const prevValues = new Map<string, number>();
  for (const s of fixtures.investments) {
    if (monthKey(s.date) === prevYm) prevValues.set(s.accountId, s.amount);
  }

  const invAccounts = fixtures.accounts.filter((a) =>
    ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'crypto', 'non_registered'].includes(a.kind),
  );

  const totalInvested = [...latestByAcc.values()].reduce((a, b) => a + b, 0);

  // Allocation by account kind
  const allocByKind = new Map<AccountKind, number>();
  for (const acc of invAccounts) {
    const val = latestByAcc.get(acc.id) ?? 0;
    allocByKind.set(acc.kind, (allocByKind.get(acc.kind) ?? 0) + val);
  }
  const allocData = [...allocByKind.entries()].map(([kind, value]) => ({
    kind,
    name: KIND_LABEL[kind],
    value: Math.round(value),
  }));

  // Contribution room
  const currentYear = Number(lastSnapYm.slice(0, 4));
  const room = contributionRoomUsed(
    fixtures.contributionEvents,
    currentYear,
    limits,
    { sanjay: 115000, anumol: 65000 },
  );

  const kidIds = fixtures.household.filter((p) => p.role === 'child').map((p) => p.id);
  const cesg = cesgStatusPerKid(
    fixtures.cesgGrants,
    kidIds,
    currentYear,
    limits,
    Number(lastSnapYm.slice(5, 7)),
  );

  // Tax hints
  const rrspSanjay = room.find((r) => r.kind === 'rrsp' && r.personId === 'sanjay');
  const marginalSanjay = estimateMarginalRate(115000);
  const projectedRrspRefund = rrspSanjay
    ? rrspSanjay.remaining * marginalSanjay
    : 0;
  const cesgAtRisk = cesg.reduce((a, c) => a + (c.status === 'behind' ? c.remainingYtd : 0), 0);

  return (
    <div className="space-y-6">
      {/* Headline */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">Total invested</div>
          <div className="num text-3xl font-semibold mt-2 text-ink">{cad(totalInvested, true)}</div>
          <div className="text-xs text-ink-dim mt-1">across {invAccounts.length} accounts · as of {lastSnapYm}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">RRSP refund opportunity</div>
          <div className="num text-3xl font-semibold mt-2 text-ink">{cad(projectedRrspRefund, true)}</div>
          <div className="text-xs text-ink-dim mt-1">
            Sanjay has {cad(rrspSanjay?.remaining ?? 0, true)} RRSP room at ~{pct(marginalSanjay, 0)} marginal
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-ink-dim">CESG left to capture this year</div>
          <div className={`num text-3xl font-semibold mt-2 ${cesgAtRisk > 0 ? 'text-amber-400' : 'text-up'}`}>
            {cad(cesg.reduce((a, c) => a + c.remainingYtd, 0), true)}
          </div>
          <div className="text-xs text-ink-dim mt-1">
            {cesgAtRisk > 0 ? `${cad(cesgAtRisk, true)} at risk if you don't catch up by Dec 31` : 'On track across all RESPs'}
          </div>
        </Card>
      </div>

      {/* Allocation + account table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Asset allocation">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={allocData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={95} paddingAngle={2}>
                  {allocData.map((d) => (
                    <Cell key={d.kind} fill={KIND_COLORS[d.kind]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => cad(v, true)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs mt-2">
            {allocData.map((d) => (
              <div key={d.kind} className="flex items-center gap-2 text-ink-muted">
                <div className="w-2 h-2 rounded-full" style={{ background: KIND_COLORS[d.kind] }} />
                {d.name} · {cadK(d.value)}
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2" title="Accounts" subtitle={`${invAccounts.length} investment accounts`}>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-dim uppercase tracking-wider border-b border-line">
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3 text-right">Value</th>
                  <th className="py-2 pr-3 text-right">MoM</th>
                  <th className="py-2 pr-3">6mo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invAccounts.map((acc) => {
                  const val = latestByAcc.get(acc.id) ?? 0;
                  const prev = prevValues.get(acc.id) ?? val;
                  const delta = prev ? (val - prev) / prev : 0;
                  const trend = (trendsByAcc[acc.id] ?? []).slice(-6);
                  const ownerName =
                    acc.beneficiaryIds?.length
                      ? acc.beneficiaryIds.map((id) => personById.get(id)?.name).filter(Boolean).join(' & ') + ' (RESP)'
                      : acc.ownerIds.map((id) => personById.get(id)?.name).filter(Boolean).join(' & ') || '—';
                  return (
                    <tr key={acc.id} className="hover:bg-bg-hover">
                      <td className="py-2 pr-3">
                        <div className="text-ink">{acc.name}</div>
                        <div className="text-xs text-ink-dim">{acc.institution} · {KIND_LABEL[acc.kind]}</div>
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{ownerName}</td>
                      <td className="py-2 pr-3 text-right"><MoneyCell amount={val} /></td>
                      <td className={`py-2 pr-3 text-right num ${delta > 0 ? 'text-up' : delta < 0 ? 'text-down' : 'text-ink-muted'}`}>
                        {pct(delta, 1)}
                      </td>
                      <td className="py-2 pr-3 w-24">
                        <div className="h-8">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trend.map((v, i) => ({ i, v }))}>
                              <YAxis hide domain={['dataMin', 'dataMax']} />
                              <Line type="monotone" dataKey="v" stroke={KIND_COLORS[acc.kind]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Contribution room */}
      <Card title="Contribution room · 2025 CRA limits" subtitle="Per person · year to date">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {room.map((r, i) => {
            const who = r.personId
              ? personById.get(r.personId)?.name
              : personById.get(r.beneficiaryId!)?.name + ' (RESP)';
            const pctUsed = r.annualLimit > 0 ? r.usedYtd / r.annualLimit : 0;
            return (
              <div key={i} className="bg-bg-elev border border-line rounded-lg p-4">
                <div className="flex justify-between items-baseline">
                  <div className="text-sm text-ink font-medium">
                    {r.kind.toUpperCase()}
                    <span className="text-ink-dim font-normal"> · {who}</span>
                  </div>
                  <Badge tone={pctUsed >= 1 ? 'positive' : pctUsed > 0.7 ? 'warning' : 'neutral'}>
                    {pct(pctUsed, 0)}
                  </Badge>
                </div>
                <div className="num text-lg text-ink mt-1">
                  {cad(r.usedYtd, true)} <span className="text-xs text-ink-dim">/ {cad(r.annualLimit, true)}</span>
                </div>
                <div className="mt-2"><Progress value={pctUsed} /></div>
                <div className="text-xs text-ink-dim mt-1">{cad(r.remaining, true)} remaining</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* CESG per kid */}
      <Card title="RESP · CESG dashboard" subtitle="20% government match on RESP contributions · $500/kid/yr · $7,200 lifetime/kid">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cesg.map((c) => {
            const kid = personById.get(c.beneficiaryId)!;
            const tone =
              c.status === 'maxed' ? 'positive' : c.status === 'on_track' ? 'info' : 'warning';
            const label = c.status === 'maxed' ? 'Maxed' : c.status === 'on_track' ? 'On track' : 'Behind';
            const pctYtd = c.capturedYtd / limits.CESG_ANNUAL_PER_CHILD;
            const pctLifetime = c.lifetimeCaptured / limits.CESG_LIFETIME_PER_CHILD;
            return (
              <div key={c.beneficiaryId} className="bg-bg-elev border border-line rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-ink font-semibold">{kid.name}</div>
                    <div className="text-xs text-ink-dim">RESP beneficiary</div>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-ink-dim mb-1">
                      <span>CESG this year</span>
                      <span className="num">{cad(c.capturedYtd, true)} / {cad(limits.CESG_ANNUAL_PER_CHILD, true)}</span>
                    </div>
                    <Progress value={pctYtd} />
                    <div className="text-xs text-ink-dim mt-1">
                      {c.remainingYtd > 0
                        ? `${cad(c.remainingYtd, true)} remaining this year`
                        : 'Maxed for this year'}
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-ink-dim mb-1">
                      <span>CESG lifetime</span>
                      <span className="num">{cad(c.lifetimeCaptured, true)} / {cad(limits.CESG_LIFETIME_PER_CHILD, true)}</span>
                    </div>
                    <Progress value={pctLifetime} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <SnapshotEditor />
      <ContributionsEditor />
    </div>
  );
}

const CONTRIBUTION_KINDS_LIST: ContributionKind[] = ['rrsp', 'tfsa', 'resp', 'fhsa'];

export function ContributionsEditor() {
  const fixtures = useAppStore((s) => s.fixtures);
  const addContribution = useAppStore((s) => s.addContribution);
  const removeContribution = useAppStore((s) => s.removeContribution);
  const people = fixtures?.household ?? [];
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
  const kids = people.filter((p) => p.role === 'child');
  const events = (fixtures?.contributionEvents ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const [f, setF] = useState({ accountId: '', personId: '', kind: 'rrsp' as ContributionKind, date: '', amount: '', beneficiaryId: '' });
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function submit() {
    setError('');
    try {
      await addContribution({
        accountId: f.accountId, personId: f.personId, kind: f.kind,
        date: f.date, amount: Number(f.amount),
        beneficiaryId: f.kind === 'resp' ? f.beneficiaryId || undefined : undefined,
      });
      setF({ ...f, date: '', amount: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink mb-3">Contributions (RRSP / TFSA / RESP / FHSA)</h2>
      <div className="flex gap-2 items-end flex-wrap mb-3">
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
          <option value="">Contributor…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          <option value="">Account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ContributionKind })}>
          {CONTRIBUTION_KINDS_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {f.kind === 'resp' && (
          <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={f.beneficiaryId} onChange={(e) => setF({ ...f, beneficiaryId: e.target.value })}>
            <option value="">Beneficiary…</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-28" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Button onClick={submit} disabled={!f.personId || !f.accountId || !f.date || !f.amount || (f.kind === 'resp' && !f.beneficiaryId)}>Add</Button>
      </div>
      {error && <p className="text-down text-sm mb-2">{error}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-dim uppercase tracking-wider"><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">Amount</th><th></th></tr></thead>
        <tbody className="divide-y divide-line">
          {events.map((e) => (
            <tr key={e.id} className="border-t border-line">
              <td className="py-1.5 pr-3 text-ink">{e.date}</td><td className="py-1.5 pr-3 text-ink-muted">{e.kind}</td><td className="py-1.5 pr-3 text-ink num">{e.amount.toLocaleString()}</td>
              <td className="text-right"><button className="text-down" onClick={() => setPendingDelete(e.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title="Delete this contribution?"
        description="This will permanently delete this contribution record."
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await removeContribution(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </Card>
  );
}

const INVESTMENT_KINDS = ['tfsa', 'rrsp', 'resp', 'fhsa', 'dcpp', 'non_registered', 'crypto'];

export function SnapshotEditor() {
  const fixtures = useAppStore((s) => s.fixtures);
  const saveSnapshot = useAppStore((s) => s.saveSnapshot);
  const removeSnapshot = useAppStore((s) => s.removeSnapshot);
  const accounts = (fixtures?.accounts ?? []).filter((a) => INVESTMENT_KINDS.includes(a.kind));
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
      <h2 className="text-lg font-semibold text-ink mb-3">Add / update value</h2>
      <div className="flex gap-2 items-end flex-wrap mb-4">
        <select className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand" placeholder="Date (YYYY-MM-DD)" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand w-32" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
