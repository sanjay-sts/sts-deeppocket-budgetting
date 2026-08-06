import { describe, expect, it } from 'vitest';

import { formatDate } from '../format';

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    expect(formatDate('2026-04-13')).toBe('Apr 13, 2026');
  });

  it('returns the raw string for an impossible date instead of throwing', () => {
    // Intl.DateTimeFormat.format(Invalid Date) throws a RangeError, which took down the
    // whole Transactions/Accounts render when corrupt dates reached the store. One bad
    // datum must degrade to odd text, never a blank page.
    expect(formatDate('2026-31-07')).toBe('2026-31-07');
  });
});
