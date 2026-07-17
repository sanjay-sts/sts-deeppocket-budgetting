import { create } from 'zustand';
import type { Fixtures, BudgetMode, CategoryId, Transaction } from '../types';
import { loadFixtures } from '../data/api';
import * as api from '../data/api';
import type { PurgeMode } from '../data/api';
import { latestMonthKey } from '../lib/kpi';

interface AppState {
  fixtures: Fixtures | null;
  selectedMonth: string;
  budgetMode: BudgetMode;
  loaded: boolean;
  init: () => Promise<void>;
  setSelectedMonth: (ym: string) => void;
  setBudgetMode: (mode: BudgetMode) => void;
  reclassifyTransaction: (txId: string, categoryId: CategoryId) => Promise<void>;
  editTransaction: (id: string, b: import('../data/api').TransactionPatchInput) => Promise<void>;
  rules: import('../data/api').RuleRow[];
  loadRules: () => Promise<void>;
  addRule: (b: { keyword: string; categoryId: string }) => Promise<void>;
  editRule: (id: string, b: { keyword?: string; categoryId?: string }) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  importTransactionsFile: (file: File) => Promise<import('../data/api').TxImportSummary>;
  refetch: () => Promise<void>;
  addPerson: (b: { name: string; role: 'adult' | 'child'; birthYear?: number }) => Promise<void>;
  editPerson: (id: string, b: { name?: string; role?: 'adult' | 'child'; birthYear?: number }) => Promise<void>;
  removePerson: (id: string, cascade?: boolean) => Promise<void>;
  addAccount: (b: { personIds: string[]; institution: string; accountType: string; kind?: string; name?: string; beneficiaryIds?: string[] }) => Promise<void>;
  editAccount: (id: string, b: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: string, cascade?: boolean) => Promise<void>;
  saveSnapshot: (b: { accountId: string; date: string; amount: number }) => Promise<void>;
  editSnapshot: (id: string, b: { date?: string; amount?: number }) => Promise<void>;
  removeSnapshot: (id: string) => Promise<void>;
  addContribution: (b: { accountId: string; personId: string; date: string; amount: number; kind: import('../types').ContributionKind; beneficiaryId?: string }) => Promise<void>;
  editContribution: (id: string, b: Record<string, unknown>) => Promise<void>;
  removeContribution: (id: string) => Promise<void>;
  importCsv: (file: File) => Promise<import('../data/api').ImportSummary>;
  purgeData: (mode: PurgeMode) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  fixtures: null,
  selectedMonth: '',
  budgetMode: 'envelope',
  loaded: false,
  rules: [],

  init: async () => {
    if (get().loaded) return;
    const f = await loadFixtures();
    set({
      fixtures: f,
      selectedMonth: latestMonthKey(f),
      budgetMode: f.budget.mode,
      loaded: true,
    });
  },

  setSelectedMonth: (ym) => set({ selectedMonth: ym }),
  setBudgetMode: (mode) => set({ budgetMode: mode }),

  reclassifyTransaction: async (txId, categoryId) => {
    const f = get().fixtures;
    if (!f) return;
    // Optimistic: swap the category locally so the UI is instant, then persist.
    const txs: Transaction[] = f.transactions.map((t) =>
      t.id === txId ? { ...t, categoryId } : t,
    );
    set({ fixtures: { ...f, transactions: txs } });
    try {
      await api.updateTransaction(txId, { categoryId });
    } finally {
      await get().refetch(); // success: confirm; failure: revert to server truth
    }
  },

  editTransaction: async (id, b) => { await api.updateTransaction(id, b); await get().refetch(); },

  loadRules: async () => { set({ rules: await api.listRules() }); },
  addRule: async (b) => { await api.createRule(b); await get().loadRules(); },
  editRule: async (id, b) => { await api.updateRule(id, b); await get().loadRules(); },
  removeRule: async (id) => { await api.deleteRule(id); await get().loadRules(); },
  importTransactionsFile: async (file) => {
    const summary = await api.importTransactionsCsv(file);
    await get().refetch();
    return summary;
  },

  refetch: async () => {
    const f = await loadFixtures();
    set({ fixtures: f });
  },
  addPerson: async (b) => { await api.createPerson(b); await get().refetch(); },
  editPerson: async (id, b) => { await api.updatePerson(id, b); await get().refetch(); },
  removePerson: async (id, cascade) => { await api.deletePerson(id, cascade); await get().refetch(); },
  addAccount: async (b) => { await api.createAccount(b); await get().refetch(); },
  editAccount: async (id, b) => { await api.updateAccount(id, b); await get().refetch(); },
  removeAccount: async (id, cascade) => { await api.deleteAccount(id, cascade); await get().refetch(); },
  saveSnapshot: async (b) => { await api.upsertSnapshot(b); await get().refetch(); },
  editSnapshot: async (id, b) => { await api.updateSnapshot(id, b); await get().refetch(); },
  removeSnapshot: async (id) => { await api.deleteSnapshot(id); await get().refetch(); },
  addContribution: async (b) => { await api.createContribution(b); await get().refetch(); },
  editContribution: async (id, b) => { await api.updateContribution(id, b as never); await get().refetch(); },
  removeContribution: async (id) => { await api.deleteContribution(id); await get().refetch(); },
  importCsv: async (file) => {
    const summary = await api.importInvestmentsCsv(file);
    await get().refetch();
    return summary;
  },
  purgeData: async (mode) => { await api.purge(mode); await get().refetch(); },
}));
