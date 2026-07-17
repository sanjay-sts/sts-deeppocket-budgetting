import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  updateTransaction: vi.fn().mockResolvedValue({}),
  createRule: vi.fn().mockResolvedValue({ id: 'r1', keyword: 'costco', categoryId: 'dining', createdAt: 'x' }),
  listRules: vi.fn().mockResolvedValue([]),
}));

import * as api from '../../data/api';
import { useAppStore } from '../useAppStore';
import type { Fixtures } from '../../types';

const fixtures = {
  transactions: [
    { id: 't1', date: '2026-01-05', accountId: 'chq', rawMerchant: 'COSTCO', merchant: 'Costco', amount: -50, categoryId: 'groceries' },
  ],
  categories: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] },
  craLimits: {}, meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  useAppStore.setState({ fixtures, loaded: true, rules: [] });
});

describe('reclassifyTransaction', () => {
  it('applies optimistically, persists via PATCH, then refetches', async () => {
    await useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { categoryId: 'dining' });
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('optimistic update is visible before the PATCH resolves', () => {
    // don't await — check synchronous state change
    void useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(useAppStore.getState().fixtures!.transactions[0]!.categoryId).toBe('dining');
  });
});

describe('rules', () => {
  it('addRule posts then reloads the rules list', async () => {
    await useAppStore.getState().addRule({ keyword: 'costco', categoryId: 'dining' });
    expect(api.createRule).toHaveBeenCalledWith({ keyword: 'costco', categoryId: 'dining' });
    expect(api.listRules).toHaveBeenCalled();
  });
});
