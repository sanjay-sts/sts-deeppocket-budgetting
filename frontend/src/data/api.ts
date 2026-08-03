// Single seam between the UI and the data source.
// M2: reads from the FastAPI backend over HTTP. This is the ONLY module that
// knows where data comes from — screens never fetch directly.

import type { Fixtures } from '../types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** The server's own explanation, without the HTTP status prefix — safe to show a user. */
  detail: string;
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
    this.detail = message;
  }
}

/** Text to show a user for a failed request: the server's explanation when there is one. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.detail) return e.detail;
  return e instanceof Error ? e.message : String(e);
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

export interface PersonInput {
  name: string;
  role: 'adult' | 'child';
  /** Omit to leave alone on update; send null to clear the stored year. */
  birthYear?: number | null;
  /** Omit to leave unset on create; send null on update to clear a recorded income. */
  grossIncome?: number | null;
}
export interface AccountInput {
  personIds: string[]; institution: string; accountType: string;
  kind?: string; name?: string; isLiability?: boolean; beneficiaryIds?: string[];
  /**
   * Balance before the first recorded transaction. Cash on hand for chequing/savings/cash,
   * amount OWED (positive) for a credit card — the same convention `meta.openingBalances`
   * uses. Importing a statement that carries a running total overwrites it.
   */
  openingBalance?: number;
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

import type { StatedRoom, StatedRoomKind } from '../types';

// CRA-stated (carry-forward) contribution room per person — issue #25.
export const upsertStatedRoom = (b: StatedRoom) => send<StatedRoom>('PUT', '/api/room', b);
export const deleteStatedRoom = (personId: string, kind: StatedRoomKind) =>
  send<void>('DELETE', `/api/room/${personId}/${kind}`);

export const createContribution = (b: ContributionInput) =>
  send<ContributionEvent>('POST', '/api/contributions', b);

import type { RecurringContribution, RecurringFrequency } from '../types';

// Recurring auto-deposit schedules — issue #28. Events materialize server-side on
// /api/data reads, so a refetch after any of these picks up generated deposits.
export interface RecurringInput {
  accountId: string; personId: string; kind: ContributionKind; amount: number;
  frequency: RecurringFrequency; startDate: string; endDate?: string; beneficiaryId?: string;
}
export const createRecurring = (b: RecurringInput) =>
  send<RecurringContribution>('POST', '/api/recurring', b);
export const updateRecurring = (id: string, b: { amount?: number; frequency?: RecurringFrequency; endDate?: string; paused?: boolean }) =>
  send<RecurringContribution>('PUT', `/api/recurring/${id}`, b);
export const deleteRecurring = (id: string) => send<void>('DELETE', `/api/recurring/${id}`);
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

/** One account whose stored opening balance was derived from a statement's running total. */
export interface OpeningBalanceChange {
  accountId: string;
  openingBalance: number;
  previousOpeningBalance: number;
  /** Where walking the transactions forward lands, vs what the newest row reports. */
  expected: number;
  reported: number;
  drift: number;
}

export interface TxImportSummary {
  created: number; duplicates: number; skipped: number;
  errors: { row: number; reason: string }[];
  categorized: { history: number; rules: number; unclassified: number };
  /** Which shape the file was read as — drives the kind preselected when creating an account. */
  format: 'bank' | 'credit_card' | 'mapped' | 'unrecognized';
  /** Account-column labels that matched nothing, deduped, so the UI can offer to create them. */
  unknownAccounts: string[];
  openingBalances: OpeningBalanceChange[];
  /** Accounts whose running totals don't add up — a gap or duplicate in the imported history. */
  reconciliation: OpeningBalanceChange[];
}

export async function importTransactionsCsv(file: File): Promise<TxImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return json<TxImportSummary>(
    await fetch(`${BASE}/api/import/transactions-csv`, { method: 'POST', body: fd }),
  );
}

export interface CsvPreview {
  headers: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  /** True when the file has no header row, so `headers` is the positional col1..colN. */
  headerless: boolean;
}
export interface CsvMapping {
  dateColumn: string;
  /** Optional: some exports are just date/debit/credit/balance with no description column. */
  merchantColumn?: string;
  amountColumn?: string;
  amountInvert?: boolean;
  debitColumn?: string;
  creditColumn?: string;
  accountColumn?: string;
  accountId?: string;
  dayFirst?: boolean;
  /** The statement's balance-after-each-transaction column. */
  runningTotalColumn?: string;
  /** Must match how the preview read the file, or the columns won't line up. */
  headerless?: boolean;
}

/** `headerless` overrides the server's guess about whether the file has a header row. */
export async function previewTransactionsCsv(file: File, headerless?: boolean): Promise<CsvPreview> {
  const fd = new FormData();
  fd.append('file', file);
  if (headerless !== undefined) fd.append('headerless', String(headerless));
  return json<CsvPreview>(
    await fetch(`${BASE}/api/import/transactions-csv/preview`, { method: 'POST', body: fd }),
  );
}

export async function importTransactionsCsvMapped(file: File, mapping: CsvMapping): Promise<TxImportSummary> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', JSON.stringify(mapping));
  return json<TxImportSummary>(
    await fetch(`${BASE}/api/import/transactions-csv/mapped`, { method: 'POST', body: fd }),
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

export interface BulkUpdateInput {
  ids: string[];
  categoryId?: string;
  isTransfer?: boolean;
  isDuplicate?: boolean;
}
export interface BulkUpdateResult { updated: number; notFound: string[] }
export interface BulkDeleteResult { deleted: number; skippedNonManual: string[]; notFound: string[] }

export const bulkUpdateTransactions = (b: BulkUpdateInput) =>
  send<BulkUpdateResult>('POST', '/api/transactions/bulk', b);
export const bulkDeleteTransactions = (ids: string[]) =>
  send<BulkDeleteResult>('POST', '/api/transactions/bulk-delete', { ids });
