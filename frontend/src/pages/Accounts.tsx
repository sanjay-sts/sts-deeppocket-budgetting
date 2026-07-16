import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MoneyCell } from '../components/shared/MoneyCell';
import { latestCashBalances, latestCreditCardOwing } from '../lib/kpi';
import { formatDate, cad } from '../lib/format';
import type { Account } from '../types';

const groupLabels = {
  cash: 'Cash accounts',
  credit: 'Credit cards',
  investments: 'Investment accounts',
};

export function Accounts() {
  const fixtures = useAppStore((s) => s.fixtures)!;
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

  const groups: Record<keyof typeof groupLabels, Account[]> = { cash: [], credit: [], investments: [] };
  for (const acc of fixtures.accounts) {
    if (acc.kind === 'chequing' || acc.kind === 'savings') groups.cash.push(acc);
    else if (acc.kind === 'credit_card') groups.credit.push(acc);
    else groups.investments.push(acc);
  }

  return (
    <div className="space-y-6">
      {(Object.keys(groups) as (keyof typeof groups)[]).map((group) => (
        <Card key={group} title={groupLabels[group]} subtitle={`${groups[group].length} accounts`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {groups[group].map((acc) => {
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
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
