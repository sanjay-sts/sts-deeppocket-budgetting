import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn().mockResolvedValue({ household: [{ id: 'p1', name: 'A', role: 'adult' }], budget: { mode: 'envelope', lines: [] } }),
  createPerson: vi.fn().mockResolvedValue({ id: 'p2', name: 'B', role: 'adult' }),
}));

import { useAppStore } from '../useAppStore';
import * as api from '../../data/api';

describe('store write→refetch', () => {
  it('addPerson calls the api then refetches via loadFixtures', async () => {
    await useAppStore.getState().addPerson({ name: 'B', role: 'adult' });
    expect(api.createPerson).toHaveBeenCalledWith({ name: 'B', role: 'adult' });
    expect(api.loadFixtures).toHaveBeenCalled();
    expect(useAppStore.getState().fixtures?.household[0].id).toBe('p1');
  });
});
