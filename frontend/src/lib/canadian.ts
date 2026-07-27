import type { CraLimits, ContributionEvent, CesgGrant, Person, PersonId, StatedRoom } from '../types';

// Aggregations for the Canadian registered-account screens.
// CESG is 20% of RESP contributions, capped $500/yr/kid and $7,200 lifetime/kid.

export interface RoomUsed {
  kind: 'tfsa' | 'rrsp' | 'resp' | 'fhsa';
  personId?: PersonId;
  beneficiaryId?: PersonId;
  usedYtd: number;
  annualLimit: number;
  remaining: number;
  /**
   * False only for RRSP rows whose owner has no recorded income and no CRA-stated room —
   * their limit is unknowable, which is different from a limit of zero. Screens must not
   * render a percentage for these.
   */
  limitKnown: boolean;
}

export function contributionRoomUsed(
  events: ContributionEvent[],
  year: number,
  limits: CraLimits,
  rrspEarnedIncomePriorYear: Record<PersonId, number>,
  statedRoom: StatedRoom[] = [],
): RoomUsed[] {
  const out: RoomUsed[] = [];
  const byPersonKind = new Map<string, number>();
  const byBeneficiaryResp = new Map<PersonId, number>();
  // CRA-stated room (issue #25): the stated amount already includes carry-forward, so it
  // replaces the flat annual limit — and a stated pair gets a row even with zero events.
  const statedByKey = new Map(statedRoom.map((s) => [`${s.personId}::${s.kind}`, s.amount]));

  for (const e of events) {
    if (!e.date.startsWith(String(year))) continue;
    if (e.kind === 'resp') {
      if (e.beneficiaryId) {
        byBeneficiaryResp.set(e.beneficiaryId, (byBeneficiaryResp.get(e.beneficiaryId) ?? 0) + e.amount);
      }
    } else {
      const key = `${e.personId}::${e.kind}`;
      byPersonKind.set(key, (byPersonKind.get(key) ?? 0) + e.amount);
    }
  }

  for (const key of statedByKey.keys()) {
    if (!byPersonKind.has(key)) byPersonKind.set(key, 0);
  }

  for (const [key, used] of byPersonKind) {
    const [personId, kind] = key.split('::') as [PersonId, 'tfsa' | 'rrsp' | 'fhsa'];
    const stated = statedByKey.get(key);
    let annualLimit = 0;
    let limitKnown = true;
    if (stated !== undefined) annualLimit = stated;
    else if (kind === 'tfsa') annualLimit = limits.TFSA_ANNUAL;
    else if (kind === 'fhsa') annualLimit = limits.FHSA_ANNUAL;
    else if (kind === 'rrsp') {
      const earned = rrspEarnedIncomePriorYear[personId];
      limitKnown = earned !== undefined;
      annualLimit = Math.min(limits.RRSP_ANNUAL_CAP, (earned ?? 0) * limits.RRSP_ANNUAL_PCT);
    }
    out.push({
      kind,
      personId,
      usedYtd: Math.round(used * 100) / 100,
      annualLimit: Math.round(annualLimit),
      remaining: Math.max(0, annualLimit - used),
      limitKnown,
    });
  }

  for (const [beneficiaryId, used] of byBeneficiaryResp) {
    out.push({
      kind: 'resp',
      beneficiaryId,
      usedYtd: Math.round(used * 100) / 100,
      annualLimit: limits.RESP_ANNUAL_FOR_FULL_CESG,
      remaining: Math.max(0, limits.RESP_ANNUAL_FOR_FULL_CESG - used),
      limitKnown: true,
    });
  }

  return out;
}

export interface CesgStatus {
  beneficiaryId: PersonId;
  capturedYtd: number;
  remainingYtd: number;
  lifetimeCaptured: number;
  lifetimeRemaining: number;
  status: 'on_track' | 'behind' | 'maxed';
}

export function cesgStatusPerKid(
  grants: CesgGrant[],
  kidIds: PersonId[],
  year: number,
  limits: CraLimits,
  currentMonth1to12: number,
): CesgStatus[] {
  return kidIds.map((kidId) => {
    const all = grants.filter((g) => g.beneficiaryId === kidId);
    const ytd = all.filter((g) => g.date.startsWith(String(year)));
    const capturedYtd = ytd.reduce((acc, g) => acc + g.amount, 0);
    const lifetime = all.reduce((acc, g) => acc + g.amount, 0);
    const remainingYtd = Math.max(0, limits.CESG_ANNUAL_PER_CHILD - capturedYtd);
    const lifetimeRemaining = Math.max(0, limits.CESG_LIFETIME_PER_CHILD - lifetime);

    // pacing: expect capturedYtd ≈ $500 * (monthsElapsed/12)
    const expectedByNow = (limits.CESG_ANNUAL_PER_CHILD * currentMonth1to12) / 12;
    let status: 'on_track' | 'behind' | 'maxed';
    if (capturedYtd >= limits.CESG_ANNUAL_PER_CHILD - 1) status = 'maxed';
    else if (capturedYtd >= expectedByNow * 0.9) status = 'on_track';
    else status = 'behind';

    return {
      beneficiaryId: kidId,
      capturedYtd: Math.round(capturedYtd * 100) / 100,
      remainingYtd: Math.round(remainingYtd * 100) / 100,
      lifetimeCaptured: Math.round(lifetime * 100) / 100,
      lifetimeRemaining: Math.round(lifetimeRemaining * 100) / 100,
      status,
    };
  });
}

// Rough marginal-rate hint for Ontario 2025 — enough for a "your refund would be ~$X" nudge.
// Not tax advice; displayed as an estimate only.
const ON_MARGINAL_2025: Array<{ upTo: number; rate: number }> = [
  // Below the basic personal amount no tax is payable, so an RRSP deduction refunds
  // nothing — without this tier a non-earner is shown a fictitious refund.
  { upTo: 15705, rate: 0 },
  { upTo: 55867, rate: 0.2005 },
  { upTo: 90000, rate: 0.2415 },
  { upTo: 111733, rate: 0.2965 },
  { upTo: 150000, rate: 0.3148 },
  { upTo: 173205, rate: 0.3391 },
  { upTo: 220000, rate: 0.3791 },
  { upTo: 246752, rate: 0.4397 },
  { upTo: Infinity, rate: 0.5353 },
];

export function estimateMarginalRate(annualIncome: number): number {
  for (const tier of ON_MARGINAL_2025) {
    if (annualIncome <= tier.upTo) return tier.rate;
  }
  return 0.5353;
}

export interface RrspOpportunity {
  personId: PersonId;
  name: string;
  remaining: number;
  marginalRate: number;
  refund: number;
  /** False when this member has no recorded income, so room/refund can't be estimated. */
  incomeKnown: boolean;
}

// Refund nudge per household adult (issue #22), driven by each member's own stored income
// (issue #23). Unlike contributionRoomUsed, adults with no recorded contributions still get
// a row — their full annual limit is open. An adult with no recorded income reports
// incomeKnown: false rather than a made-up figure; the screen prompts for it instead.
export function rrspRefundOpportunities(
  household: Person[],
  events: ContributionEvent[],
  year: number,
  limits: CraLimits,
  statedRoom: StatedRoom[] = [],
): RrspOpportunity[] {
  return household
    .filter((p) => p.role === 'adult')
    .map((p) => {
      const incomeKnown = typeof p.grossIncome === 'number';
      const income = p.grossIncome ?? 0;
      const annualLimit = incomeKnown
        ? Math.min(limits.RRSP_ANNUAL_CAP, income * limits.RRSP_ANNUAL_PCT)
        : 0;
      const marginalRate = incomeKnown ? estimateMarginalRate(income) : 0;
      // CRA-stated room (incl. carry-forward, issue #25) beats the income estimate.
      const stated = statedRoom.find((s) => s.personId === p.id && s.kind === 'rrsp')?.amount;
      const limit = stated ?? annualLimit;
      const used = events
        .filter((e) => e.kind === 'rrsp' && e.personId === p.id && e.date.startsWith(String(year)))
        .reduce((a, e) => a + e.amount, 0);
      const remaining = Math.max(0, Math.round((limit - used) * 100) / 100);
      return {
        personId: p.id, name: p.name, remaining, marginalRate,
        refund: remaining * marginalRate, incomeKnown,
      };
    });
}
