import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  createAccount: vi.fn().mockResolvedValue({ id: 'acc_new' }),
  updateAccount: vi.fn().mockResolvedValue({ id: 'acc_1' }),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '../../data/api';
import { useAppStore } from '../useAppStore';
import type { Fixtures } from '../../types';

const fixtures = {
  transactions: [], categories: [], household: [], investments: [],
  accounts: [{ id: 'acc_1', name: 'Visa', kind: 'credit_card', institution: 'TD', ownerIds: ['p1'] }],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] },
  craLimits: {}, meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: { acc_1: 100 } },
} as unknown as Fixtures;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  useAppStore.setState({ fixtures, loaded: true, toasts: [] });
});

// The account actions had no coverage at all, despite being the only write path for the
// banking accounts a CSV import has to resolve against.
describe('account actions', () => {
  it('addAccount posts then refetches so the new account shows up', async () => {
    await useAppStore.getState().addAccount({
      personIds: ['p1'], institution: 'TD', accountType: 'credit_card',
      kind: 'credit_card', openingBalance: 333.54,
    });
    expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({ kind: 'credit_card' }));
    expect(api.loadFixtures).toHaveBeenCalled();
  });

  it('addAccount failures propagate so the form can show them inline', async () => {
    vi.mocked(api.createAccount).mockRejectedValueOnce(new Error('409 duplicate'));
    await expect(useAppStore.getState().addAccount({
      personIds: ['p1'], institution: 'TD', accountType: 'credit_card',
    })).rejects.toThrow('409 duplicate');
  });

  it('editAccount sends only the fields given', async () => {
    await useAppStore.getState().editAccount('acc_1', { openingBalance: 0 });
    expect(api.updateAccount).toHaveBeenCalledWith('acc_1', { openingBalance: 0 });
  });

  it('removeAccount passes the cascade flag through for a forced delete', async () => {
    await useAppStore.getState().removeAccount('acc_1');
    expect(api.deleteAccount).toHaveBeenCalledWith('acc_1', undefined);

    await useAppStore.getState().removeAccount('acc_1', true);
    expect(api.deleteAccount).toHaveBeenLastCalledWith('acc_1', true);
  });
});
