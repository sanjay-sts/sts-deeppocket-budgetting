import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  updateTransaction: vi.fn().mockResolvedValue({}),
  createRule: vi.fn(), listRules: vi.fn().mockResolvedValue([]),
  createCategory: vi.fn().mockResolvedValue({ id: 'pets', name: 'Pets', group: 'family' }),
  updateCategory: vi.fn().mockResolvedValue({}),
  deleteCategory: vi.fn().mockResolvedValue({
    deleted: true, transactionsReassigned: 3, rulesDeleted: 1, budgetLineDeleted: true,
  }),
  upsertBudgetLine: vi.fn().mockResolvedValue({}),
  deleteBudgetLine: vi.fn().mockResolvedValue(undefined),
  updateBudgetConfig: vi.fn().mockResolvedValue({ mode: 'zero_based' }),
  createTransaction: vi.fn().mockResolvedValue({ id: 'txn_m_1' }),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
  bulkUpdateTransactions: vi.fn().mockResolvedValue({ updated: 2, notFound: [] }),
  bulkDeleteTransactions: vi.fn().mockResolvedValue({ deleted: 1, skippedNonManual: ['b1'], notFound: [] }),
}));

import * as api from '../../data/api';
import { useAppStore } from '../useAppStore';
import type { Fixtures } from '../../types';

const fixtures = {
  transactions: [
    { id: 't1', date: '2026-01-05', accountId: 'chq', rawMerchant: 'X', merchant: 'X', amount: -1, categoryId: 'groceries', source: 'manual' },
  ],
  categories: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] },
  craLimits: {}, meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  useAppStore.setState({ fixtures, loaded: true, rules: [], toasts: [], budgetMode: 'envelope' });
});

describe('toasts', () => {
  it('pushToast appends and dismissToast removes', () => {
    useAppStore.getState().pushToast('boom');
    const t = useAppStore.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0]!.message).toBe('boom');
    useAppStore.getState().dismissToast(t[0]!.id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('reclassifyTransaction toasts and refetches on failure', async () => {
    vi.mocked(api.updateTransaction).mockRejectedValueOnce(new Error('500'));
    await useAppStore.getState().reclassifyTransaction('t1', 'dining');
    expect(useAppStore.getState().toasts[0]!.message).toContain("Couldn't save");
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('setBudgetMode persists via config PATCH and reverts + toasts on failure', async () => {
    useAppStore.getState().setBudgetMode('zero_based');
    expect(api.updateBudgetConfig).toHaveBeenCalledWith({ mode: 'zero_based' });

    vi.mocked(api.updateBudgetConfig).mockRejectedValueOnce(new Error('500'));
    useAppStore.getState().setBudgetMode('fifty_thirty_twenty');
    await vi.waitFor(() => expect(useAppStore.getState().budgetMode).toBe('zero_based'));
    expect(useAppStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('m4 actions', () => {
  it('addCategory posts then refetches; failures propagate', async () => {
    await useAppStore.getState().addCategory({ name: 'Pets', group: 'family' });
    expect(api.createCategory).toHaveBeenCalled();
    expect(api.loadFixtures).toHaveBeenCalled();
    vi.mocked(api.createCategory).mockRejectedValueOnce(new Error('409'));
    await expect(useAppStore.getState().addCategory({ name: 'Pets', group: 'family' })).rejects.toThrow();
  });

  it('removeCategory returns the cascade counts', async () => {
    const r = await useAppStore.getState().removeCategory('groceries');
    expect(r.transactionsReassigned).toBe(3);
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('saveBudgetLine toasts instead of throwing on failure', async () => {
    vi.mocked(api.upsertBudgetLine).mockRejectedValueOnce(new Error('500'));
    await useAppStore.getState().saveBudgetLine('groceries', { monthlyCap: 100, rollover: false });
    expect(useAppStore.getState().toasts).toHaveLength(1);
  });

  it('removeTransaction removes optimistically and calls DELETE', async () => {
    await useAppStore.getState().removeTransaction('t1');
    expect(api.deleteTransaction).toHaveBeenCalledWith('t1');
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('addTransaction posts and refetches; failures propagate', async () => {
    await useAppStore.getState().addTransaction({ accountId: 'cash_wallet', date: '2026-07-10', merchant: 'M', amount: -5 });
    expect(api.createTransaction).toHaveBeenCalled();
    vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error('422'));
    await expect(
      useAppStore.getState().addTransaction({ accountId: 'cash_wallet', date: '2026-07-10', merchant: 'M', amount: -5 }),
    ).rejects.toThrow();
  });

  it('bulkUpdateTransactions returns the summary and refetches', async () => {
    const r = await useAppStore.getState().bulkUpdateTransactions({ ids: ['t1', 't2'], categoryId: 'dining' });
    expect(r.updated).toBe(2);
    expect(api.bulkUpdateTransactions).toHaveBeenCalledWith({ ids: ['t1', 't2'], categoryId: 'dining' });
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('bulkDeleteTransactions returns the summary incl. skipped bank rows', async () => {
    const r = await useAppStore.getState().bulkDeleteTransactions(['m1', 'b1']);
    expect(r.deleted).toBe(1);
    expect(r.skippedNonManual).toEqual(['b1']);
    expect(api.bulkDeleteTransactions).toHaveBeenCalledWith(['m1', 'b1']);
  });
});
