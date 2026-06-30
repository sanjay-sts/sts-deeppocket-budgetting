import { create } from 'zustand';
import type { Fixtures, BudgetMode, CategoryId, Transaction } from '../types';
import { loadFixtures } from '../data/api';
import * as api from '../data/api';
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
  removePerson: (id: string) => Promise<void>;
  addAccount: (b: { personId: string; institution: string; accountType: string; kind?: string; name?: string; beneficiaryId?: string }) => Promise<void>;
  editAccount: (id: string, b: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  saveSnapshot: (b: { accountId: string; date: string; amount: number }) => Promise<void>;
  editSnapshot: (id: string, b: { date?: string; amount?: number }) => Promise<void>;
  removeSnapshot: (id: string) => Promise<void>;
  importCsv: (file: File) => Promise<import('../data/api').ImportSummary>;
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
  removePerson: async (id) => { await api.deletePerson(id); await get().refetch(); },
  addAccount: async (b) => { await api.createAccount(b); await get().refetch(); },
  editAccount: async (id, b) => { await api.updateAccount(id, b); await get().refetch(); },
  removeAccount: async (id) => { await api.deleteAccount(id); await get().refetch(); },
  saveSnapshot: async (b) => { await api.upsertSnapshot(b); await get().refetch(); },
  editSnapshot: async (id, b) => { await api.updateSnapshot(id, b); await get().refetch(); },
  removeSnapshot: async (id) => { await api.deleteSnapshot(id); await get().refetch(); },
  importCsv: async (file) => {
    const summary = await api.importInvestmentsCsv(file);
    await get().refetch();
    return summary;
  },
}));
