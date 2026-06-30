import { describe, it, expect } from 'vitest';
import { contributionRoomUsed, cesgStatusPerKid } from '../canadian';
import type { CraLimits, ContributionEvent, CesgGrant } from '../../types';

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
