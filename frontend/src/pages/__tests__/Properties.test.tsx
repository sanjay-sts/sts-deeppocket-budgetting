import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  createAccount: vi.fn().mockResolvedValue({ id: 'acc_new' }),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  listSnapshots: vi.fn().mockResolvedValue([]),
  upsertSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

import { useAppStore } from '../../store/useAppStore';
import { Properties } from '../Properties';
import type { Fixtures } from '../../types';
import * as api from '../../data/api';

const fixtures = {
  household: [{ id: 'p1', name: 'Sanjay', role: 'adult' }],
  accounts: [
    { id: 'chq', name: 'Sanjay TD chequing', kind: 'chequing', institution: 'TD', ownerIds: ['p1'] },
    {
      id: 'prop1', name: 'Maple Grove house', kind: 'property', institution: '142 Maple Grove Ave',
      ownerIds: ['p1'], purchasePrice: 500000, purchaseDate: '2019-06-28',
    },
    {
      id: 'mort1', name: 'Maple Trust Mortgage', kind: 'mortgage', institution: 'Maple Trust',
      ownerIds: ['p1'], isLiability: true, linkedAccountId: 'prop1',
    },
  ],
  categories: [], transactions: [],
  investments: [
    { date: '2026-06-30', accountId: 'prop1', amount: 650000 },
    { date: '2026-06-30', accountId: 'mort1', amount: 400000 },
  ],
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
  vi.mocked(api.createAccount).mockResolvedValue({ id: 'acc_new' } as never);
  vi.mocked(api.loadFixtures).mockResolvedValue(fixtures);
  vi.mocked(api.listSnapshots).mockResolvedValue([]);
  useAppStore.setState({ fixtures, loaded: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<MemoryRouter><Properties /></MemoryRouter>));
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function typeInto(input: HTMLInputElement, value: string) {
  nativeValue.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!match) throw new Error(`no button labelled "${text}"; saw: ${
    [...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`);
  return match as HTMLButtonElement;
}

describe('Properties page', () => {
  it('shows market value, mortgage balance, and derived equity per property', async () => {
    await render();
    expect(container.textContent).toContain('Maple Grove house');
    expect(container.textContent).toContain('$650,000'); // latest valuation
    expect(container.textContent).toContain('$400,000'); // outstanding principal
    expect(container.textContent).toContain('$250,000'); // equity = value − mortgage
  });

  it('shows appreciation since purchase when purchase info is set', async () => {
    await render();
    expect(container.textContent).toContain('$150,000'); // 650k now vs 500k paid
  });

  it('creates a property with the rental flag and purchase fields', async () => {
    await render();
    await act(async () => buttonByText('Add property').click());

    const inputs = () => [...container.querySelectorAll('input')] as HTMLInputElement[];
    const address = inputs().find((i) => i.getAttribute('list') === 'property-form-institutions')!;
    await act(async () => typeInto(address, '88 Birch St'));
    await act(async () => buttonByText('Owner').click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const rental = inputs().find((i) => i.type === 'checkbox' && i.getAttribute('aria-label') === 'Rental property')!;
    await act(async () => rental.click());
    const price = inputs().find((i) => i.getAttribute('placeholder') === 'Purchase price')!;
    await act(async () => typeInto(price, '480000'));
    await act(async () => buttonByText('Create property').click());

    expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'property', institution: '88 Birch St', personIds: ['p1'],
      isRental: true, purchasePrice: 480000,
    }));
  });
});
