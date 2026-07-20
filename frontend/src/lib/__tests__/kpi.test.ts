import { describe, it, expect } from 'vitest';
import { netWorth, netWorthByKind, latestInvestmentSnapshot, round2 } from '../kpi';
import type { Account, Fixtures, InvestmentSnapshot, Transaction } from '../../types';

const LIMITS = {
  TFSA_ANNUAL: 7000, RRSP_ANNUAL_PCT: 0.18, RRSP_ANNUAL_CAP: 32490,
  RESP_LIFETIME_PER_CHILD: 50000, RESP_ANNUAL_FOR_FULL_CESG: 2500,
  FHSA_ANNUAL: 8000, FHSA_LIFETIME: 40000, CESG_RATE: 0.2,
  CESG_ANNUAL_PER_CHILD: 500, CESG_LIFETIME_PER_CHILD: 7200,
};

function fx(investments: InvestmentSnapshot[]): Fixtures {
  return {
    household: [],
    accounts: [{ id: 'inv1', name: 'TFSA', kind: 'tfsa', institution: 'Q', ownerIds: ['p1'] }],
    categories: [], transactions: [],
    investments,
    contributionEvents: [], cesgGrants: [],
    budget: { mode: 'envelope', lines: [] },
    craLimits: LIMITS,
    meta: { generatedAt: '2025-01-01', seed: 0, monthsCovered: 1, openingBalances: {} },
  };
}

// Fuller fixtures for the by-kind breakdown: cash, three investment kinds
// (incl. non_registered — issue #8), and a credit card carrying a balance.
function fxBreakdown(): Fixtures {
  const accounts: Account[] = [
    { id: 'chq', name: 'Chequing', kind: 'chequing', institution: 'RBC', ownerIds: ['p1'] },
    { id: 'tfsa1', name: 'TFSA', kind: 'tfsa', institution: 'WS', ownerIds: ['p1'] },
    { id: 'nr1', name: 'Non-reg', kind: 'non_registered', institution: 'WS', ownerIds: ['p1'] },
    { id: 'cc1', name: 'Visa', kind: 'credit_card', institution: 'RBC', ownerIds: ['p1'], isLiability: true },
  ];
  const transactions: Transaction[] = [
    { id: 't1', date: '2025-03-01', accountId: 'chq', rawMerchant: 'X', merchant: 'X', amount: 1000, categoryId: 'salary', source: 'bank' },
    // CC internal sum negative = balance owed
    { id: 't2', date: '2025-03-05', accountId: 'cc1', rawMerchant: 'Y', merchant: 'Y', amount: -250, categoryId: 'groceries', source: 'bank' },
  ];
  const f = fx([
    { date: '2025-03-31', accountId: 'tfsa1', amount: 5000 },
    { date: '2025-03-31', accountId: 'nr1', amount: 3000 },
  ]);
  return { ...f, accounts, transactions, meta: { ...f.meta, openingBalances: { chq: 500 } } };
}

describe('netWorthByKind', () => {
  it('includes a non_registered row with its own label (issue #8)', () => {
    const nr = netWorthByKind(fxBreakdown()).find((r) => r.kind === 'non_registered');
    expect(nr).toBeDefined();
    expect(nr!.label).toBe('Non-registered');
    expect(nr!.value).toBe(3000);
  });

  it('rows sum exactly to the net-worth total — nothing silently dropped', () => {
    const f = fxBreakdown();
    const sum = round2(netWorthByKind(f).reduce((a, r) => a + r.value, 0));
    expect(sum).toBe(netWorth(f).total);
  });

  it('orders cash first, investment kinds in between, liabilities last', () => {
    const kinds = netWorthByKind(fxBreakdown()).map((r) => r.kind);
    expect(kinds).toEqual(['chequing', 'tfsa', 'non_registered', 'credit_card']);
  });

  it('liability rows carry a negative value so the sum works out', () => {
    const cc = netWorthByKind(fxBreakdown()).find((r) => r.kind === 'credit_card');
    expect(cc!.value).toBe(-250);
    expect(cc!.label).toBe('Credit card debt');
  });
});

describe('netWorth investments', () => {
  it('uses the latest snapshot per account', () => {
    const f = fx([
      { date: '2025-01-31', accountId: 'inv1', amount: 1000 },
      { date: '2025-02-28', accountId: 'inv1', amount: 1500 },
    ]);
    expect(latestInvestmentSnapshot(f)).toHaveLength(1);
    expect(netWorth(f).investments).toBe(1500);
  });

  it('recomputes when a newer snapshot is added', () => {
    const f = fx([{ date: '2025-01-31', accountId: 'inv1', amount: 1000 }]);
    expect(netWorth(f).investments).toBe(1000);
    f.investments.push({ date: '2025-03-31', accountId: 'inv1', amount: 2000 });
    expect(netWorth(f).investments).toBe(2000);
  });
});
