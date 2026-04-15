import { create } from 'zustand';
import type { Fixtures, BudgetMode, CategoryId, Transaction } from '../types';
import { loadFixtures } from '../data/api';
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
}));
