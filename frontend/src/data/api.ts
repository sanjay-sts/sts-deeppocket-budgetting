// Single seam between the UI and the data source.
// M2: reads from the FastAPI backend over HTTP. This is the ONLY module that
// knows where data comes from — screens never fetch directly.

import type { Fixtures } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, statusText: string, body: unknown) {
    const detail =
      typeof body === 'object' && body !== null && 'detail' in (body as Record<string, unknown>)
        ? (body as { detail: unknown }).detail
        : body;
    const message = typeof detail === 'object' && detail !== null ? JSON.stringify(detail) : String(detail);
    super(`${status} ${statusText}: ${message}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    throw new ApiError(res.status, res.statusText, body);
  }
  return res.json() as Promise<T>;
}

export async function loadFixtures(): Promise<Fixtures> {
  return json<Fixtures>(await fetch(`${BASE}/api/data`));
}

import type { Person, Account } from '../types';

interface PersonInput { name: string; role: 'adult' | 'child'; birthYear?: number }
interface AccountInput {
  personIds: string[]; institution: string; accountType: string;
  kind?: string; name?: string; isLiability?: boolean; beneficiaryIds?: string[];
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  return json<T>(res);
}

export const createPerson = (b: PersonInput) => send<Person>('POST', '/api/people', b);
export const updatePerson = (id: string, b: Partial<PersonInput>) =>
  send<Person>('PUT', `/api/people/${id}`, b);
export const deletePerson = (id: string, cascade = false) =>
  send<void>('DELETE', `/api/people/${id}${cascade ? '?cascade=true' : ''}`);

export const createAccount = (b: AccountInput) => send<Account>('POST', '/api/accounts', b);
export const updateAccount = (id: string, b: Partial<AccountInput>) =>
  send<Account>('PUT', `/api/accounts/${id}`, b);
export const deleteAccount = (id: string, cascade = false) =>
  send<void>('DELETE', `/api/accounts/${id}${cascade ? '?cascade=true' : ''}`);

// Danger-zone bulk purge. `investments` wipes all account/contribution/snapshot data but
// keeps people; `all` wipes those and people too; `demo` wipes then reseeds demo data.
export type PurgeMode = 'investments' | 'all' | 'demo';
export const purge = (mode: PurgeMode) =>
  send<{ mode: PurgeMode; ok: boolean }>('POST', '/api/admin/purge', { mode });

export interface SnapshotRow { id: string; accountId: string; date: string; amount: number }
export interface ImportSummary {
  created: number; updated: number; skipped: number;
  errors: { row: number; reason: string }[];
}

export const listSnapshots = (accountId: string) =>
  send<SnapshotRow[]>('GET', `/api/snapshots?account_id=${encodeURIComponent(accountId)}`);
export const upsertSnapshot = (b: { accountId: string; date: string; amount: number }) =>
  send<SnapshotRow>('POST', '/api/snapshots', b);
export const updateSnapshot = (id: string, b: { date?: string; amount?: number }) =>
  send<SnapshotRow>('PUT', `/api/snapshots/${id}`, b);
export const deleteSnapshot = (id: string) => send<void>('DELETE', `/api/snapshots/${id}`);

export async function importInvestmentsCsv(file: File): Promise<ImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return json<ImportSummary>(await fetch(`${BASE}/api/import/investments-csv`, { method: 'POST', body: fd }));
}

import type { ContributionEvent, ContributionKind } from '../types';

interface ContributionInput {
  accountId: string; personId: string; date: string;
  amount: number; kind: ContributionKind; beneficiaryId?: string;
}

export const createContribution = (b: ContributionInput) =>
  send<ContributionEvent>('POST', '/api/contributions', b);
export const updateContribution = (id: string, b: Partial<ContributionInput>) =>
  send<ContributionEvent>('PUT', `/api/contributions/${id}`, b);
export const deleteContribution = (id: string) =>
  send<void>('DELETE', `/api/contributions/${id}`);
