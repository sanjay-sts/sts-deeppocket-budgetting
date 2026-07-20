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

import type { Transaction } from '../types';

export interface TransactionPatchInput {
  categoryId?: string;
  isTransfer?: boolean;
  isDuplicate?: boolean;
  notes?: string;   // '' clears
  tags?: string[];  // [] clears
  // manual rows only — 422 on bank rows:
  date?: string;
  merchant?: string;
  amount?: number;
  accountId?: string;
}

export const updateTransaction = (id: string, b: TransactionPatchInput) =>
  send<Transaction>('PATCH', `/api/transactions/${id}`, b);

export interface RuleRow { id: string; keyword: string; categoryId: string; createdAt: string }

export const listRules = () => send<RuleRow[]>('GET', '/api/rules');
export const createRule = (b: { keyword: string; categoryId: string }) =>
  send<RuleRow>('POST', '/api/rules', b);
export const updateRule = (id: string, b: { keyword?: string; categoryId?: string }) =>
  send<RuleRow>('PUT', `/api/rules/${id}`, b);
export const deleteRule = (id: string) => send<void>('DELETE', `/api/rules/${id}`);

export interface TxImportSummary {
  created: number; duplicates: number; skipped: number;
  errors: { row: number; reason: string }[];
  categorized: { history: number; rules: number; unclassified: number };
}

export async function importTransactionsCsv(file: File): Promise<TxImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return json<TxImportSummary>(
    await fetch(`${BASE}/api/import/transactions-csv`, { method: 'POST', body: fd }),
  );
}

import type { Category, CategoryGroup, Bucket503020, BudgetMode } from '../types';

export interface CategoryInput {
  name: string;
  group: CategoryGroup;
  bucket503020?: Bucket503020;
  isEssential?: boolean;
}
export interface CategoryPatchInput {
  name?: string;
  group?: CategoryGroup;
  bucket503020?: Bucket503020 | ''; // '' clears
  isEssential?: boolean;
}
export interface CategoryDeleteResult {
  deleted: boolean;
  transactionsReassigned: number;
  rulesDeleted: number;
  budgetLineDeleted: boolean;
}

export const createCategory = (b: CategoryInput) => send<Category>('POST', '/api/categories', b);
export const updateCategory = (id: string, b: CategoryPatchInput) =>
  send<Category>('PATCH', `/api/categories/${id}`, b);
export const deleteCategory = (id: string) =>
  send<CategoryDeleteResult>('DELETE', `/api/categories/${id}`);

export interface BudgetLineWire { categoryId: string; monthlyCap: number; rollover: boolean }

export const upsertBudgetLine = (categoryId: string, b: { monthlyCap: number; rollover: boolean }) =>
  send<BudgetLineWire>('PUT', `/api/budget/lines/${categoryId}`, b);
export const deleteBudgetLine = (categoryId: string) =>
  send<void>('DELETE', `/api/budget/lines/${categoryId}`);
export const updateBudgetConfig = (b: { mode?: BudgetMode; targetSavingsRate?: number }) =>
  send<{ mode: BudgetMode; targetSavingsRate?: number }>('PATCH', '/api/budget/config', b);

export interface TransactionCreateInput {
  accountId: string;
  date: string;
  merchant: string;
  amount: number;
  categoryId?: string; // omitted -> server auto-categorizes
  notes?: string;
  tags?: string[];
}

export const createTransaction = (b: TransactionCreateInput) =>
  send<Transaction>('POST', '/api/transactions', b);
export const deleteTransaction = (id: string) => send<void>('DELETE', `/api/transactions/${id}`);
