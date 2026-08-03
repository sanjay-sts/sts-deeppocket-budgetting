import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { AccountForm } from '../components/shared/AccountForm';
import { ConfirmDeleteModal } from '../components/shared/ConfirmDeleteModal';
import { latestCashBalances, latestCreditCardOwing } from '../lib/kpi';
import { formatDate, cad } from '../lib/format';
import type { Account, AccountKind } from '../types';

// Cash and credit accounts are editable here; investment accounts stay in Settings, where
// the RESP beneficiary handling lives. `defaultKind` is what the group's Add button creates.
const GROUPS = [
  {
    key: 'cash', label: 'Cash accounts', addLabel: 'Add cash account',
    submitLabel: 'Create account', defaultKind: 'chequing' as AccountKind,
  },
  {
    key: 'credit', label: 'Credit cards', addLabel: 'Add credit card',
    submitLabel: 'Create card', defaultKind: 'credit_card' as AccountKind,
  },
  { key: 'investments', label: 'Investment accounts', addLabel: null, submitLabel: null, defaultKind: null },
] as const;

type GroupKey = (typeof GROUPS)[number]['key'];

export function Accounts() {
  const fixtures = useAppStore((s) => s.fixtures)!;
  const addAccount = useAppStore((s) => s.addAccount);
  const editAccount = useAppStore((s) => s.editAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);

  const [adding, setAdding] = useState<AccountKind | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const cash = useMemo(() => latestCashBalances(fixtures), [fixtures]);
  const ccOwed = useMemo(() => latestCreditCardOwing(fixtures), [fixtures]);
  const balanceByAcc = new Map<string, number>();
  for (const b of cash) balanceByAcc.set(b.accountId, b.balance);
  for (const b of ccOwed) balanceByAcc.set(b.accountId, b.balance);

  const latestByInvAcc = new Map<string, number>();
  const sortedInv = [...fixtures.investments].sort((a, b) => a.date.localeCompare(b.date));
  for (const s of sortedInv) latestByInvAcc.set(s.accountId, s.amount);
  for (const [id, v] of latestByInvAcc) balanceByAcc.set(id, v);

  const lastTxByAcc = new Map<string, string>();
  for (const t of fixtures.transactions) {
    const prev = lastTxByAcc.get(t.accountId);
    if (!prev || t.date > prev) lastTxByAcc.set(t.accountId, t.date);
  }

  const groups: Record<GroupKey, Account[]> = { cash: [], credit: [], investments: [] };
  for (const acc of fixtures.accounts) {
    if (acc.kind === 'chequing' || acc.kind === 'savings' || acc.kind === 'cash') groups.cash.push(acc);
    else if (acc.kind === 'credit_card') groups.credit.push(acc);
    else groups.investments.push(acc);
  }

  const institutions = [...new Set(fixtures.accounts.map((a) => a.institution))].sort();
  const pendingAccount = fixtures.accounts.find((a) => a.id === pendingDelete) ?? null;
  const editing = fixtures.accounts.find((a) => a.id === editingId) ?? null;

  // AccountForm surfaces its own submit failures, so there is no page-level error to clear.
  function closeForms() {
    setAdding(null);
    setEditingId(null);
  }

  return (
    <div className="space-y-6">
      {GROUPS.map(({ key, label, addLabel, submitLabel, defaultKind }) => (
        <Card
          key={key}
          title={label}
          subtitle={`${groups[key].length} account${groups[key].length === 1 ? '' : 's'}`}
          action={addLabel && (
            <Button
              variant="secondary"
              onClick={() => { closeForms(); setAdding(defaultKind); }}
            >
              {addLabel}
            </Button>
          )}
        >
          {adding !== null && defaultKind === adding && (
            <div className="mb-4">
              <AccountForm
                people={fixtures.household}
                institutions={institutions}
                defaultKind={adding}
                submitLabel={submitLabel ?? 'Create account'}
                onCancel={closeForms}
                onSubmit={async (input) => { await addAccount(input); closeForms(); }}
              />
            </div>
          )}

          {editing && groups[key].some((a) => a.id === editing.id) && (
            <div className="mb-4">
              <AccountForm
                people={fixtures.household}
                institutions={institutions}
                account={editing}
                openingBalance={fixtures.meta.openingBalances[editing.id] ?? 0}
                submitLabel="Save account"
                onCancel={closeForms}
                onSubmit={async (input) => { await editAccount(editing.id, input); closeForms(); }}
              />
            </div>
          )}

          {groups[key].length === 0 && adding !== defaultKind && (
            <p className="text-sm text-ink-dim">
              {key === 'investments'
                ? 'No investment accounts yet.'
                : `No ${label.toLowerCase()} yet. ${addLabel} to import its statements.`}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {groups[key].map((acc) => {
              const balance = balanceByAcc.get(acc.id) ?? 0;
              const lastTx = lastTxByAcc.get(acc.id);
              const isLiability = acc.kind === 'credit_card';
              return (
                <div key={acc.id} className="bg-bg-elev border border-line rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-ink font-medium">{acc.name}</div>
                      <div className="text-xs text-ink-dim">{acc.institution}</div>
                    </div>
                    <Badge tone={isLiability ? 'negative' : 'info'}>{acc.kind.replace('_', ' ')}</Badge>
                  </div>
                  <div className={`num text-2xl mt-3 ${isLiability ? 'text-down' : 'text-ink'}`}>
                    {isLiability ? '−' : ''}{cad(Math.abs(balance), true)}
                  </div>
                  {lastTx && (
                    <div className="text-xs text-ink-dim mt-1">Last activity {formatDate(lastTx)}</div>
                  )}
                  {key === 'investments' ? (
                    <div className="text-xs text-ink-dim mt-2">
                      <Link className="hover:text-ink underline" to="/settings">Edit in Settings</Link>
                    </div>
                  ) : (
                    <div className="text-xs mt-2">
                      <button
                        className="text-ink-muted hover:text-ink"
                        onClick={() => { closeForms(); setEditingId(acc.id); }}
                      >
                        Edit
                      </button>
                      <button className="text-down ml-3" onClick={() => setPendingDelete(acc.id)}>Remove</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={`Remove ${pendingAccount?.name ?? 'this account'}?`}
        description="Deleting the account deletes its imported transactions too."
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
