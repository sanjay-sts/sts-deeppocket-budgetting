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

// The refund card derives from real household records (issue #22) — now including each
// member's own stored income rather than one assumed figure (issue #23).
describe('rrspRefundOpportunities', () => {
  // Generated ids like the CSV importer creates — the original bug hardcoded a person id.
  const household: Person[] = [
    { id: 'p_9f31c204', name: 'Avery', role: 'adult', grossIncome: 100000 },
    { id: 'p_5b7de118', name: 'Jordan', role: 'adult', grossIncome: 100000 },
    { id: 'p_kid', name: 'Milo', role: 'child' },
  ];

  it('gives every adult full room when no contributions are recorded', () => {
    const out = rrspRefundOpportunities(household, [], 2026, LIMITS);
    expect(out.map((o) => o.personId)).toEqual(['p_9f31c204', 'p_5b7de118']);
    // 18% of 100k, under the cap; marginal 29.65% for that bracket.
    expect(out[0].remaining).toBe(18000);
    expect(out[0].marginalRate).toBeCloseTo(0.2965, 6);
    expect(out[0].refund).toBeCloseTo(18000 * 0.2965, 6);
    expect(out[0].incomeKnown).toBe(true);
  });

  it('uses each adult\'s own income, not a shared assumption', () => {
    const mixed: Person[] = [
      { id: 'hi', name: 'Avery', role: 'adult', grossIncome: 300000 },
      { id: 'lo', name: 'Jordan', role: 'adult', grossIncome: 50000 },
    ];
    const out = rrspRefundOpportunities(mixed, [], 2026, LIMITS);
    // 18% of 300k would be 54k, so the cap binds; 18% of 50k does not
    expect(out.find((o) => o.personId === 'hi')!.remaining).toBe(32490);
    expect(out.find((o) => o.personId === 'hi')!.marginalRate).toBeCloseTo(0.5353, 6);
    expect(out.find((o) => o.personId === 'lo')!.remaining).toBe(9000);
    expect(out.find((o) => o.personId === 'lo')!.marginalRate).toBeCloseTo(0.2005, 6);
  });

  it('subtracts this year\'s RRSP contributions and ignores other years/kinds/people', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_9f31c204', amount: 5000, kind: 'rrsp' },
      { id: 'c2', date: '2025-03-01', accountId: 'a', personId: 'p_9f31c204', amount: 9000, kind: 'rrsp' },
      { id: 'c3', date: '2026-03-01', accountId: 'a', personId: 'p_9f31c204', amount: 2000, kind: 'tfsa' },
      { id: 'c4', date: '2026-03-01', accountId: 'a', personId: 'p_5b7de118', amount: 1000, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS);
    expect(out.find((o) => o.personId === 'p_9f31c204')!.remaining).toBe(13000);
    expect(out.find((o) => o.personId === 'p_5b7de118')!.remaining).toBe(17000);
  });

  it('excludes children and never returns negative room', () => {
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_9f31c204', amount: 99999, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS);
    expect(out.some((o) => o.personId === 'p_kid')).toBe(false);
    expect(out.find((o) => o.personId === 'p_9f31c204')!.remaining).toBe(0);
  });

  it('flags an adult with no recorded income instead of inventing one', () => {
    const out = rrspRefundOpportunities([{ id: 'x', name: 'Sam', role: 'adult' }], [], 2026, LIMITS);
    expect(out[0].incomeKnown).toBe(false);
    expect(out[0].remaining).toBe(0);
    expect(out[0].refund).toBe(0);
  });

  it('treats a recorded zero income as known — it is a real answer', () => {
    const out = rrspRefundOpportunities(
      [{ id: 'x', name: 'Sam', role: 'adult', grossIncome: 0 }], [], 2026, LIMITS);
    expect(out[0].incomeKnown).toBe(true);
    expect(out[0].remaining).toBe(0);
  });

  it('CRA-stated RRSP room supersedes the income-derived limit (issue #25)', () => {
    const stated: StatedRoom[] = [{ personId: 'p_9f31c204', kind: 'rrsp', amount: 61000 }];
    const events: ContributionEvent[] = [
      { id: 'c1', date: '2026-03-01', accountId: 'a', personId: 'p_9f31c204', amount: 1000, kind: 'rrsp' },
    ];
    const out = rrspRefundOpportunities(household, events, 2026, LIMITS, stated);
    expect(out.find((o) => o.personId === 'p_9f31c204')!.remaining).toBe(60000);
    // Jordan has no stated room -> income-derived 18k stands
    expect(out.find((o) => o.personId === 'p_5b7de118')!.remaining).toBe(18000);
  });

  it('stated room still counts when income is unknown, but the refund cannot be estimated', () => {
    const stated: StatedRoom[] = [{ personId: 'x', kind: 'rrsp', amount: 40000 }];
    const out = rrspRefundOpportunities(
      [{ id: 'x', name: 'Sam', role: 'adult' }], [], 2026, LIMITS, stated);
    expect(out[0].remaining).toBe(40000);
    expect(out[0].incomeKnown).toBe(false);
    expect(out[0].refund).toBe(0);
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
