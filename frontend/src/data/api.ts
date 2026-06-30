// Single seam between the UI and the data source.
// M2: reads from the FastAPI backend over HTTP. This is the ONLY module that
// knows where data comes from — screens never fetch directly.

import type { Fixtures } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function loadFixtures(): Promise<Fixtures> {
  return json<Fixtures>(await fetch(`${BASE}/api/data`));
}

import type { Person, Account } from '../types';

interface PersonInput { name: string; role: 'adult' | 'child'; birthYear?: number }
interface AccountInput {
  personId: string; institution: string; accountType: string;
  kind?: string; name?: string; isLiability?: boolean; beneficiaryId?: string;
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
export const deletePerson = (id: string) => send<void>('DELETE', `/api/people/${id}`);

export const createAccount = (b: AccountInput) => send<Account>('POST', '/api/accounts', b);
export const updateAccount = (id: string, b: Partial<AccountInput>) =>
  send<Account>('PUT', `/api/accounts/${id}`, b);
export const deleteAccount = (id: string) => send<void>('DELETE', `/api/accounts/${id}`);

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
