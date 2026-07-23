import { describe, it, expect } from 'vitest';
import { contributionRoomUsed, cesgStatusPerKid, rrspRefundOpportunities } from '../canadian';
import type { CraLimits, ContributionEvent, CesgGrant, Person, StatedRoom } from '../../types';

const LIMITS: CraLimits = {
  TFSA_ANNUAL: 7000, RRSP_ANNUAL_PCT: 0.18, RRSP_ANNUAL_CAP: 32490,
  RESP_LIFETIME_PER_CHILD: 50000, RESP_ANNUAL_FOR_FULL_CESG: 2500,
  FHSA_ANNUAL: 8000, FHSA_LIFETIME: 40000, CESG_RATE: 0.2,
  CESG_ANNUAL_PER_CHILD: 500, CESG_LIFETIME_PER_CHILD: 7200,
};

describe('contributionRoomUsed', () => {
  it('sums TFSA contributions and computes remaining', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2025-02-01', accountId: 'a', personId: 'p1', amount: 3000, kind: 'tfsa' },
    ];
    const tfsa = contributionRoomUsed(events, 2025, LIMITS, {}).find(
      (r) => r.kind === 'tfsa' && r.personId === 'p1')!;
    expect(tfsa.usedYtd).toBe(3000);
    expect(tfsa.remaining).toBe(4000);
  });

  it('ignores contributions outside the year', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2024-12-31', accountId: 'a', personId: 'p1', amount: 3000, kind: 'tfsa' },
    ];
    expect(contributionRoomUsed(events, 2025, LIMITS, {})).toHaveLength(0);
  });

  // CRA-stated (carry-forward) room — issue #25.
  it('emits a row for stated room even with zero contributions', () => {
    const stated: StatedRoom[] = [{ personId: 'p1', kind: 'tfsa', amount: 42000 }];
    const rows = contributionRoomUsed([], 2025, LIMITS, {}, stated);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'tfsa', personId: 'p1', usedYtd: 0, annualLimit: 42000, remaining: 42000,
    });
  });

  it('stated room replaces the annual limit and events subtract from it — one row per pair', () => {
    const stated: StatedRoom[] = [{ personId: 'p1', kind: 'tfsa', amount: 42000 }];
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2025-02-01', accountId: 'a', personId: 'p1', amount: 3000, kind: 'tfsa' },
    ];
    const rows = contributionRoomUsed(events, 2025, LIMITS, {}, stated);
    const tfsa = rows.filter((r) => r.kind === 'tfsa' && r.personId === 'p1');
    expect(tfsa).toHaveLength(1);
    expect(tfsa[0].usedYtd).toBe(3000);
    expect(tfsa[0].annualLimit).toBe(42000);
    expect(tfsa[0].remaining).toBe(39000);
  });

  it('pairs without stated room keep the flat annual limit', () => {
    const stated: StatedRoom[] = [{ personId: 'p1', kind: 'rrsp', amount: 50000 }];
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2025-02-01', accountId: 'a', personId: 'p2', amount: 3000, kind: 'tfsa' },
    ];
    const rows = contributionRoomUsed(events, 2025, LIMITS, {}, stated);
    expect(rows.find((r) => r.personId === 'p1' && r.kind === 'rrsp')!.annualLimit).toBe(50000);
    expect(rows.find((r) => r.personId === 'p2' && r.kind === 'tfsa')!.annualLimit).toBe(7000);
  });
});

// RRSP refund card must derive from real household records, not mock ids (issue #22).
describe('rrspRefundOpportunities', () => {
  // Generated ids like the CSV importer creates — the original bug hardcoded 'sanjay'.
  const household: Person[] = [
    { id: 'p_2ee08097', name: 'sanjay', role: 'adult' },
    { id: 'p_fa0430a4', name: 'anumol', role: 'adult' },
    { id: 'p_kid', name: 'mira', role: 'child' },
  ];

  it('gives every adult full room when no contributions are recorded', () => {
    const out = rrspRefundOpportunities(household, [], 2026, LIMITS, 100000);
    expect(out.map((o) => o.personId)).toEqual(['p_2ee08097', 'p_fa0430a4']);
    // 18% of 100k, under the cap; marginal 29.65% for that bracket.
    expect(out[0].remaining).toBe(18000);
    expect(out[0].marginalRate).toBeCloseTo(0.2965, 6);
    expect(out[0].refund).toBeCloseTo(18000 * 0.2965, 6);
  });

  it('subtracts this year\'s RRSP contributions and ignores other years/kinds/people', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_2ee08097', amount: 5000, kind: 'rrsp' },
      { id: 'c2', date: '2025-03-01', accountId: 'a', personId: 'p_2ee08097', amount: 9000, kind: 'rrsp' },
      { id: 'c3', date: '2026-03-01', accountId: 'a', personId: 'p_2ee08097', amount: 2000, kind: 'tfsa' },
      { id: 'c4', date: '2026-03-01', accountId: 'a', personId: 'p_fa0430a4', amount: 1000, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS, 100000);
    expect(out.find((o) => o.personId === 'p_2ee08097')!.remaining).toBe(13000);
    expect(out.find((o) => o.personId === 'p_fa0430a4')!.remaining).toBe(17000);
  });

  it('excludes children and never returns negative room', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_2ee08097', amount: 99999, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS, 100000);
    expect(out.some((o) => o.personId === 'p_kid')).toBe(false);
    expect(out.find((o) => o.personId === 'p_2ee08097')!.remaining).toBe(0);
  });

  it('caps the annual limit at RRSP_ANNUAL_CAP for high incomes', () => {
    const out = rrspRefundOpportunities(household.slice(0, 1), [], 2026, LIMITS, 300000);
    expect(out[0].remaining).toBe(32490); // 18% of 300k would be 54k
    expect(out[0].marginalRate).toBeCloseTo(0.5353, 6);
  });

  it('CRA-stated RRSP room supersedes the income-derived limit (issue #25)', () => {
    const stated: StatedRoom[] = [{ personId: 'p_2ee08097', kind: 'rrsp', amount: 61000 }];
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_2ee08097', amount: 1000, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS, 100000, stated);
    expect(out.find((o) => o.personId === 'p_2ee08097')!.remaining).toBe(60000);
    // anumol has no stated room -> income-derived 18k stands
    expect(out.find((o) => o.personId === 'p_fa0430a4')!.remaining).toBe(18000);
  });
});

describe('cesgStatusPerKid', () => {
  it('reports captured + lifetime-remaining grants for a kid', () => {
    const grants: CesgGrant[] = [
      { id: 'g1', date: '2025-02-01', beneficiaryId: 'k1', contributionEventId: 'c1', amount: 200, accountId: 'a' },
    ];
    const out = cesgStatusPerKid(grants, ['k1'], 2025, LIMITS, 6);
    expect(out[0].capturedYtd).toBe(200);
    expect(out[0].lifetimeRemaining).toBe(7000);
  });
});
