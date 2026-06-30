import { describe, it, expect } from 'vitest';
import { netWorth, latestInvestmentSnapshot } from '../kpi';
import type { Fixtures, InvestmentSnapshot } from '../../types';

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
    categories: [], rules: [], transactions: [],
    investments,
    contributionEvents: [], cesgGrants: [],
    budget: { mode: 'envelope', lines: [] },
    craLimits: LIMITS,
    meta: { generatedAt: '2025-01-01', seed: 0, monthsCovered: 1, openingBalances: {} },
  };
}

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
