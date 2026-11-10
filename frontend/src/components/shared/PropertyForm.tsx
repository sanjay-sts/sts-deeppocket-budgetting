import { useState } from 'react';
import { Button } from '../ui/Button';
import { MultiSelect } from '../ui/MultiSelect';
import type { AccountInput } from '../../data/api';
import type { Account, AccountKind, Person } from '../../types';

const inputClass =
  'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand';
const selectClass =
  'w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand';

interface PropertyFormProps {
  people: Person[];
  /** Property accounts a mortgage can be linked to. */
  properties: { id: string; name: string }[];
  /** Omit for a create form; pass an account to edit one. */
  account?: Account;
  defaultKind?: Extract<AccountKind, 'property' | 'mortgage'>;
  submitLabel?: string;
  onSubmit: (input: AccountInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Create/edit form for a property or its mortgage. Institution doubles as the address
 * (property) or the lender (mortgage). There is no opening balance — value always comes
 * from snapshots (market value / outstanding principal) on the Properties page.
 */
export function PropertyForm({
  people, properties, account, defaultKind = 'property',
  submitLabel = 'Save', onSubmit, onCancel,
}: PropertyFormProps) {
  const editing = account !== undefined;
  const [kind, setKind] = useState<'property' | 'mortgage'>(
    account?.kind === 'mortgage' ? 'mortgage' : editing ? 'property' : defaultKind,
  );
  const [name, setName] = useState(account?.customName ?? '');
  const [personIds, setPersonIds] = useState<string[]>(account?.ownerIds ?? []);
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [isRental, setIsRental] = useState(account?.isRental ?? false);
  const [purchasePrice, setPurchasePrice] = useState(
    account?.purchasePrice !== undefined ? String(account.purchasePrice) : '',
  );
  const [purchaseDate, setPurchaseDate] = useState(account?.purchaseDate ?? '');
  const [linkedAccountId, setLinkedAccountId] = useState(account?.linkedAccountId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ownerOptions = people.map((p) => ({ id: p.id, label: p.name }));
  const isProperty = kind === 'property';

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const price = purchasePrice.trim() === '' ? null : Number(purchasePrice.replace(/[$,]/g, ''));
      if (price !== null && !Number.isFinite(price)) {
        throw new Error('Purchase price must be a number.');
      }
      // On create, blank/inapplicable fields are omitted; on edit they send an explicit
      // null, which clears what the field used to hold (a sold rental, an unlinked
      // mortgage) — the API treats absent as "leave alone".
      const unset = editing ? null : undefined;
      await onSubmit({
        personIds, institution: institution.trim(), accountType: kind, kind,
        name: name.trim() || undefined,
        isRental: isProperty ? isRental : unset,
        purchasePrice: isProperty && price !== null ? price : unset,
        purchaseDate: isProperty && purchaseDate.trim() ? purchaseDate.trim() : unset,
        linkedAccountId: !isProperty && linkedAccountId ? linkedAccountId : unset,
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
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'property' | 'mortgage')}
            className={selectClass}
            disabled={editing}
          >
            <option value="property">Property</option>
            <option value="mortgage">Mortgage</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Owner
          <MultiSelect options={ownerOptions} selected={personIds} onChange={setPersonIds} placeholder="Owner" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          {isProperty ? 'Address' : 'Lender'}
          <input
            className={inputClass}
            list="property-form-institutions"
            placeholder={isProperty ? 'e.g. 142 Maple Grove Ave' : 'Who holds the mortgage'}
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
          <datalist id="property-form-institutions" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Name <span className="text-ink-dim">(optional)</span>
          <input
            className={inputClass}
            placeholder={isProperty ? 'e.g. Birch St rental' : 'e.g. Maple Trust mortgage'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {isProperty ? (
          <>
            <label className="flex items-center gap-2 text-xs text-ink-dim md:col-span-2">
              <input
                type="checkbox"
                className="accent-brand"
                aria-label="Rental property"
                checked={isRental}
                onChange={(e) => setIsRental(e.target.checked)}
              />
              Rental property — track its cashflow (rent in vs money out)
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-dim">
              Purchase price <span className="text-ink-dim">(optional)</span>
              <input
                className={inputClass}
                placeholder="Purchase price"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-dim">
              Purchase date <span className="text-ink-dim">(optional)</span>
              <input
                type="date"
                className={`${inputClass} [color-scheme:dark]`}
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-ink-dim md:col-span-2">
            Property it encumbers
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className={selectClass}
            >
              <option value="">— not linked —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className="text-ink-dim">Linking lets the property card show equity (value − mortgage).</span>
          </label>
        )}
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
