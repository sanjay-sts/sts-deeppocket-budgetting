import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadFixtures, createPerson, createAccount, deleteAccount, previewTransactionsCsv,
  importTransactionsCsvMapped, ApiError,
} from '../api';

function okJson(payload: unknown) {
  return vi.fn().mockResolvedValue(
    { ok: true, status: 200, json: async () => payload } as unknown as Response);
}

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

  it('throws ApiError with structured detail on blocked deletes', async () => {
    const detail = { message: 'blocked', snapshotCount: 2, contributionCount: 1 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ detail }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    let error: unknown;
    try {
      await deleteAccount('acc_1');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect((apiError.body as { detail: typeof detail }).detail.snapshotCount).toBe(2);
  });

  it('createAccount sends the kind and opening balance', async () => {
    const fetchMock = okJson({ id: 'acc_1', kind: 'credit_card' });
    vi.stubGlobal('fetch', fetchMock);

    await createAccount({
      personIds: ['p1'], institution: 'TD', accountType: 'credit_card',
      kind: 'credit_card', name: 'Sanjay TD AeroPlan Card', openingBalance: 333.54,
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.kind).toBe('credit_card');
    expect(body.openingBalance).toBe(333.54);
    expect(body.name).toBe('Sanjay TD AeroPlan Card');
  });

  it('previewTransactionsCsv only sends a headerless override when given one', async () => {
    const fetchMock = okJson({ headers: [], sampleRows: [], rowCount: 0, headerless: false });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['a,b\n'], 'x.csv');

    await previewTransactionsCsv(file);
    expect(((fetchMock.mock.calls[0]![1] as RequestInit).body as FormData).has('headerless')).toBe(false);

    await previewTransactionsCsv(file, true);
    const fd = (fetchMock.mock.calls[1]![1] as RequestInit).body as FormData;
    expect(fd.get('headerless')).toBe('true');
  });

  it('importTransactionsCsvMapped carries the running-total column and headerless flag', async () => {
    const fetchMock = okJson({ created: 0 });
    vi.stubGlobal('fetch', fetchMock);

    await importTransactionsCsvMapped(new File(['x'], 'x.csv'), {
      dateColumn: 'col1', debitColumn: 'col3', creditColumn: 'col4',
      runningTotalColumn: 'col5', accountId: 'acc_1', headerless: true,
    });

    const fd = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    const mapping = JSON.parse(fd.get('mapping') as string);
    expect(mapping.runningTotalColumn).toBe('col5');
    expect(mapping.headerless).toBe(true);
    // A description column is optional now, so it must not be sent as an empty string.
    expect(mapping.merchantColumn).toBeUndefined();
  });
});
