import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PropertyForm } from '../components/shared/PropertyForm';
import { SnapshotEditor } from '../components/shared/SnapshotEditor';
import { ConfirmDeleteModal } from '../components/shared/ConfirmDeleteModal';
import { latestInvestmentSnapshot } from '../lib/kpi';
import { cad, formatDate } from '../lib/format';
import type { Account } from '../types';

export function Properties() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const addAccount = useAppStore((s) => s.addAccount);
  const editAccount = useAppStore((s) => s.editAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);

  const [adding, setAdding] = useState<'property' | 'mortgage' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const properties = fixtures.accounts.filter((a) => a.kind === 'property');
  const mortgages = fixtures.accounts.filter((a) => a.kind === 'mortgage');

  // Latest snapshot per account = current market value / outstanding principal.
  const valueByAcc = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of latestInvestmentSnapshot(fixtures)) m.set(s.accountId, s.amount);
    return m;
  }, [fixtures]);

  const editing = fixtures.accounts.find((a) => a.id === editingId) ?? null;
  const pendingAccount = fixtures.accounts.find((a) => a.id === pendingDelete) ?? null;
  const unlinkedMortgages = mortgages.filter(
    (m) => !m.linkedAccountId || !properties.some((p) => p.id === m.linkedAccountId),
  );

  function closeForms() {
    setAdding(null);
    setEditingId(null);
  }

  function form(account?: Account) {
    return (
      <div className="mb-4">
        <PropertyForm
          people={fixtures.household}
          properties={properties}
          account={account}
          defaultKind={adding ?? 'property'}
          submitLabel={account ? 'Save' : adding === 'mortgage' ? 'Create mortgage' : 'Create property'}
          onCancel={closeForms}
          onSubmit={async (input) => {
            if (account) await editAccount(account.id, input);
            else await addAccount(input);
            closeForms();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card
        title="Properties"
        subtitle={`${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { closeForms(); setAdding('property'); }}>
              Add property
            </Button>
            <Button variant="secondary" onClick={() => { closeForms(); setAdding('mortgage'); }}>
              Add mortgage
            </Button>
          </div>
        }
      >
        {adding !== null && form()}
        {editing && form(editing)}

        {properties.length === 0 && adding === null && (
          <p className="text-sm text-ink-dim">
            No properties yet. Add one, then record its market value below — the mortgage
            links to it so the card can show your equity.
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {properties.map((prop) => {
            const mortgage = mortgages.find((m) => m.linkedAccountId === prop.id);
            const value = valueByAcc.get(prop.id);
            const owing = mortgage ? valueByAcc.get(mortgage.id) : undefined;
            const equity = value !== undefined ? value - (owing ?? 0) : undefined;
            const appreciation =
              value !== undefined && prop.purchasePrice ? value - prop.purchasePrice : undefined;
            return (
              <div key={prop.id} className="bg-bg-elev border border-line rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-ink font-medium">{prop.name}</div>
                    <div className="text-xs text-ink-dim">{prop.institution}</div>
                  </div>
                  <Badge tone={prop.isRental ? 'warning' : 'info'}>
                    {prop.isRental ? 'rental' : 'property'}
                  </Badge>
                </div>

                <div className="num text-2xl mt-3 text-ink">
                  {value !== undefined ? cad(value, true) : '—'}
                </div>
                <div className="text-xs text-ink-dim">
                  {value !== undefined ? 'market value (latest snapshot)' : 'no valuation yet — add one below'}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div>
                    <div className="text-xs text-ink-dim">Mortgage</div>
                    <div className="num text-down">
                      {owing !== undefined ? `−${cad(owing, true)}` : mortgage ? '—' : 'none'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-dim">Equity</div>
                    <div className="num text-ink">{equity !== undefined ? cad(equity, true) : '—'}</div>
                  </div>
                </div>

                {appreciation !== undefined && (
                  <div className="text-xs text-ink-dim mt-2">
                    {appreciation >= 0 ? '+' : '−'}{cad(Math.abs(appreciation), true)} since purchase
                    {prop.purchaseDate ? ` (${formatDate(prop.purchaseDate)})` : ''}
                  </div>
                )}

                <div className="text-xs mt-3">
                  <button
                    className="text-ink-muted hover:text-ink"
                    onClick={() => { closeForms(); setEditingId(prop.id); }}
                  >
                    Edit
                  </button>
                  {mortgage && (
                    <button
                      className="text-ink-muted hover:text-ink ml-3"
                      onClick={() => { closeForms(); setEditingId(mortgage.id); }}
                    >
                      Edit mortgage
                    </button>
                  )}
                  <button className="text-down ml-3" onClick={() => setPendingDelete(prop.id)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {unlinkedMortgages.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-ink-dim mb-2">
              Mortgages not linked to a property
            </div>
            <div className="space-y-1.5 text-sm">
              {unlinkedMortgages.map((m) => (
                <div key={m.id} className="flex items-center gap-3 bg-bg-elev border border-line rounded-md px-3 py-1.5">
                  <span className="text-ink">{m.name}</span>
                  <span className="num text-down">
                    {valueByAcc.get(m.id) !== undefined ? `−${cad(valueByAcc.get(m.id)!, true)}` : '—'}
                  </span>
                  <span className="flex-1" />
                  <button
                    className="text-ink-muted hover:text-ink"
                    onClick={() => { closeForms(); setEditingId(m.id); }}
                  >
                    Edit
                  </button>
                  <button className="text-down" onClick={() => setPendingDelete(m.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <SnapshotEditor
        accounts={[...properties, ...mortgages]}
        title="Record value / mortgage balance"
      />

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={`Remove ${pendingAccount?.name ?? 'this account'}?`}
        description="Its value history is deleted; transactions tagged to a property just lose the tag."
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
    </div>
  );
}
