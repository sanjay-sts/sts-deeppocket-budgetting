import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixtures, createPerson } from '../api';

describe('api seam', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loadFixtures GETs /api/data', async () => {
    const payload = { household: [] };
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: async () => payload } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFixtures();
    expect(fetchMock).toHaveBeenCalledWith('/api/data');
    expect(data).toBe(payload);
  });

  it('createPerson POSTs JSON to /api/people', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ id: 'p_1', name: 'A', role: 'adult' }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const p = await createPerson({ name: 'A', role: 'adult' });
    expect(fetchMock).toHaveBeenCalledWith('/api/people', expect.objectContaining({ method: 'POST' }));
    expect(p.id).toBe('p_1');
  });

  it('throws on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: false, status: 409, statusText: 'Conflict', text: async () => 'dup' } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(createPerson({ name: 'A', role: 'adult' })).rejects.toThrow('409');
  });
});
