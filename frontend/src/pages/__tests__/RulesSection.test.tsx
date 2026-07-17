import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  listRules: vi.fn().mockResolvedValue([]),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}));

import { useAppStore } from '../../store/useAppStore';
import { RulesSection } from '../Settings';
import type { Fixtures } from '../../types';
import * as api from '../../data/api';

const fixtures = {
  categories: [
    { id: 'groceries', name: 'Groceries', group: 'essentials' },
    { id: 'dining', name: 'Dining', group: 'lifestyle' },
  ],
  transactions: [], accounts: [], household: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] }, craLimits: {},
  meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: {} },
} as unknown as Fixtures;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  vi.mocked(api.listRules).mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RulesSection', () => {
  it('lists rules with keyword and category name', async () => {
    vi.mocked(api.listRules).mockResolvedValue([
      { id: 'r1', keyword: 'costco', categoryId: 'groceries', createdAt: '2026-01-01' },
    ]);
    useAppStore.setState({
      fixtures, loaded: true,
      rules: [{ id: 'r1', keyword: 'costco', categoryId: 'groceries', createdAt: '2026-01-01' }],
    });
    await act(async () => root.render(<RulesSection />));
    expect(container.textContent).toContain('costco');
    expect(container.textContent).toContain('Groceries');
  });

  it('shows the empty state when no rules exist', async () => {
    useAppStore.setState({ fixtures, loaded: true, rules: [] });
    await act(async () => root.render(<RulesSection />));
    expect(container.textContent).toContain('No rules yet');
  });
});
