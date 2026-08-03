import { useState } from 'react';
import { Button } from '../ui/Button';
import { MultiSelect } from '../ui/MultiSelect';
import { autoName } from '../../lib/account';
import type { AccountInput } from '../../data/api';
import type { Account, AccountKind, Person } from '../../types';

// Kinds this form offers. Investment kinds are managed in Settings, where the RESP
// beneficiary handling already lives, so they are deliberately absent here.
export const BANK_KIND_OPTIONS: { kind: AccountKind; label: string }[] = [
  { kind: 'credit_card', label: 'Credit card' },
  { kind: 'chequing', label: 'Chequing' },
  { kind: 'savings', label: 'Savings' },
  { kind: 'cash', label: 'Cash / wallet' },
];

const inputClass =
  'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
const selectClass =
  'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand';

interface AccountFormProps {
  people: Person[];
  /** Institutions already in use, offered as a datalist. */
  institutions: string[];
  /** Omit for a create form; pass an account (and its opening balance) to edit one. */
  account?: Account;
  openingBalance?: number;
  /** Preselected kind for a create form — the group's kind, or the CSV format's. */
  defaultKind?: AccountKind;
  /** Prefills the name, so an unmatched CSV label becomes the account's name verbatim. */
  defaultName?: string;
  submitLabel?: string;
  onSubmit: (input: AccountInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Create/edit form for a cash or credit-card account.
 *
 * Opening balance means cash on hand for chequing/savings/cash and amount OWED for a credit
 * card, matching `meta.openingBalances`. It is only worth typing when the statements being
 * imported carry no running total — one that does overrides this value on import.
 */
export function AccountForm({
  people, institutions, account, openingBalance, defaultKind, defaultName,
  submitLabel = 'Add account', onSubmit, onCancel,
}: AccountFormProps) {
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? defaultKind ?? 'credit_card');
  const [name, setName] = useState(account?.customName ?? defaultName ?? '');
  const [personIds, setPersonIds] = useState<string[]>(account?.ownerIds ?? []);
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [accountType, setAccountType] = useState(account?.accountType ?? '');
  const [opening, setOpening] = useState(
    openingBalance !== undefined && openingBalance !== 0 ? String(openingBalance) : '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ownerOptions = people.map((p) => ({ id: p.id, label: p.name }));
  // The account type doubles as the display-name suffix, so default it to the kind rather
  // than making the user retype "credit_card" to get a sensible auto name.
  const effectiveType = accountType.trim() || kind;
  const preview = autoName(personIds, institution, effectiveType, people);
  const owesLabel = kind === 'credit_card';

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const parsed = opening.trim() === '' ? undefined : Number(opening.replace(/[$,]/g, ''));
      if (parsed !== undefined && !Number.isFinite(parsed)) {
        throw new Error('Opening balance must be a number.');
      }
      await onSubmit({
        personIds, institution: institution.trim(), accountType: effectiveType, kind,
        name: name.trim() || undefined,
        openingBalance: parsed,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const incomplete = personIds.length === 0 || !institution.trim();

  return (
    <div className="bg-bg-elev border border-line rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={selectClass}>
            {BANK_KIND_OPTIONS.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Owner
          <MultiSelect options={ownerOptions} selected={personIds} onChange={setPersonIds} placeholder="Owner" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Institution
          <input
            className={inputClass}
            list="account-form-institutions"
            placeholder="Your bank or card issuer"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
          <datalist id="account-form-institutions">
            {institutions.map((inst) => <option key={inst} value={inst} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Account type <span className="text-ink-dim">(optional)</span>
          <input
            className={inputClass}
            placeholder={kind}
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim md:col-span-2">
          Name <span className="text-ink-dim">(optional — matched against a CSV&rsquo;s account column)</span>
          <input
            className={inputClass}
            placeholder={preview || 'Auto name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim md:col-span-2">
          {owesLabel ? 'Opening balance owed' : 'Opening balance'}
          <input
            className={inputClass}
            placeholder="0.00"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
          <span className="text-ink-dim">
            {owesLabel
              ? 'What the card owed before the oldest transaction you import.'
              : 'The balance before the oldest transaction you import.'}
            {' '}Leave blank if your statements include a running-total column — the import works it out.
          </span>
        </label>
      </div>
      {error && <p className="text-down text-sm mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={busy || incomplete}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
