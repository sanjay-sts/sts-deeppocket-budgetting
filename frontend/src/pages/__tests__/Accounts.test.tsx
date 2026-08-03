import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../data/api', () => ({
  loadFixtures: vi.fn(),
  createAccount: vi.fn().mockResolvedValue({ id: 'acc_new' }),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

import { useAppStore } from '../../store/useAppStore';
import { Accounts } from '../Accounts';
import type { Fixtures } from '../../types';
import * as api from '../../data/api';

const fixtures = {
  household: [{ id: 'p1', name: 'Sanjay', role: 'adult' }],
  accounts: [
    { id: 'chq', name: 'Sanjay TD chequing', kind: 'chequing', institution: 'TD', ownerIds: ['p1'] },
    { id: 'visa', name: 'Sanjay TD AeroPlan Card', kind: 'credit_card', institution: 'TD', ownerIds: ['p1'], isLiability: true },
    { id: 'tfsa1', name: 'Sanjay WS tfsa', kind: 'tfsa', institution: 'WS', ownerIds: ['p1'] },
  ],
  categories: [], transactions: [], investments: [],
  contributionEvents: [], cesgGrants: [],
  budget: { mode: 'envelope', lines: [] }, craLimits: {},
  meta: { generatedAt: '', seed: 0, monthsCovered: 0, openingBalances: { chq: 500, visa: 333.54 } },
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
  useAppStore.setState({ fixtures, loaded: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<MemoryRouter><Accounts /></MemoryRouter>));
}

// React tracks the last value it wrote, so assigning `.value` directly is swallowed.
// Going through the prototype setter is what makes React see the change.
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

describe('Accounts page', () => {
  it('offers to add a credit card and a cash account', async () => {
    await render();
    expect(container.textContent).toContain('Add credit card');
    expect(container.textContent).toContain('Add cash account');
  });

  it('sends a credit_card kind and a typed opening balance', async () => {
    await render();
    await act(async () => buttonByText('Add credit card').click());

    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
    const institution = inputs.find((i) => i.getAttribute('list') === 'account-form-institutions')!;
    await act(async () => typeInto(institution, 'TD'));
    // Owner is required, so pick the only person via the MultiSelect checkbox.
    await act(async () => buttonByText('Owner').click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    // Amount owed before the first imported row.
    await act(async () => typeInto(inputs[inputs.length - 1]!, '333.54'));
    await act(async () => buttonByText('Create card').click());

    expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'credit_card', institution: 'TD', personIds: ['p1'], openingBalance: 333.54,
      // Account type defaults to the kind so the auto name reads sensibly.
      accountType: 'credit_card',
    }));
  });

  it('shows a credit card as money owed and a chequing account as money held', async () => {
    await render();
    // Card: 333.54 opening owed, rendered with the negative marker; chequing: 500 held.
    expect(container.textContent).toContain('−$334');
    expect(container.textContent).toContain('$500');
  });

  it('routes investment accounts to Settings rather than editing them here', async () => {
    await render();
    expect(container.textContent).toContain('Edit in Settings');
    const editable = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Edit');
    // Only the chequing and credit-card tiles are editable in place.
    expect(editable).toHaveLength(2);
  });

  it('warns that deleting an account takes its transactions with it', async () => {
    await render();
    const remove = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
    await act(async () => (remove as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('deletes its imported transactions too');
  });
});
