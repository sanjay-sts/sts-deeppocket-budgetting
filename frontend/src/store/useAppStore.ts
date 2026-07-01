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
  reclassifyTransaction: (txId: string, categoryId: CategoryId) => void;
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

  reclassifyTransaction: (txId, categoryId) => {
    const f = get().fixtures;
    if (!f) return;
    const txs: Transaction[] = f.transactions.map((t) =>
      t.id === txId ? { ...t, categoryId } : t,
    );
    set({ fixtures: { ...f, transactions: txs } });
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
