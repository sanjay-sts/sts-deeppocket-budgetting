import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { ApiError } from '../../data/api';

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  // When onConfirm throws a structured blocked-delete 409 and this is provided, the blocked
  // view also renders a destructive "Delete anyway" button that force-deletes (cascade).
  onForceConfirm?: () => Promise<void>;
  // When set, the normal view renders a type-to-confirm input; the confirm button stays
  // disabled until the typed value exactly (case-sensitively) equals this phrase.
  confirmPhrase?: string;
}

// Known structured-detail count fields the backend may send on a blocked (409) delete,
// mapped to [singular, plural] plain-language labels.
const COUNT_LABELS: Record<string, [string, string]> = {
  snapshotCount: ['snapshot', 'snapshots'],
  contributionCount: ['contribution', 'contributions'],
  ownedAccountCount: ['owned account', 'owned accounts'],
  beneficiaryAccountCount: ['beneficiary account', 'beneficiary accounts'],
};

function describeBlockedDelete(detail: Record<string, unknown>): string {
  const parts = Object.entries(detail)
    .filter(([key, value]) => key !== 'message' && typeof value === 'number' && value > 0)
    .map(([key, value]) => {
      const count = value as number;
      const [singular, plural] = COUNT_LABELS[key] ?? [key, key];
      return `${count} ${count === 1 ? singular : plural}`;
    });

  if (!parts.length) {
    return typeof detail.message === 'string' ? detail.message : 'This item still has dependent data.';
  }
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This still has ${joined}. Remove those first.`;
}

// True when an ApiError body carries the structured blocked-delete shape:
// { detail: { message, ...counts } } where detail is an object (not a plain string).
function isBlockedDeleteError(e: unknown): e is ApiError & { body: { detail: Record<string, unknown> } } {
  if (!(e instanceof ApiError)) return false;
  const body = e.body;
  if (typeof body !== 'object' || body === null || !('detail' in body)) return false;
  const detail = (body as { detail: unknown }).detail;
  return typeof detail === 'object' && detail !== null;
}

export function ConfirmDeleteModal({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  onForceConfirm,
  confirmPhrase,
}: ConfirmDeleteModalProps) {
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  // These modals (Household / Investment-account deletes) stay mounted and only toggle `open`,
  // so clear transient state whenever the modal closes — otherwise a prior blocked view,
  // inline error, or typed phrase leaks into the next thing the user opens.
  useEffect(() => {
    if (!open) {
      setBlockedMessage(null);
      setError('');
      setBusy(false);
      setTyped('');
    }
  }, [open]);

  if (!open) return null;

  function reset() {
    setBlockedMessage(null);
    setError('');
    setBusy(false);
    setTyped('');
  }

  function handleCancel() {
    reset();
    onCancel();
  }

  async function handleConfirm() {
    setError('');
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      if (isBlockedDeleteError(e)) {
        setBlockedMessage(describeBlockedDelete(e.body.detail));
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForceConfirm() {
    if (!onForceConfirm) return;
    setError('');
    setBusy(true);
    try {
      await onForceConfirm();
      // On success the caller closes the modal; nothing else to do here.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const phraseGated = confirmPhrase !== undefined;
  const phraseSatisfied = !phraseGated || typed === confirmPhrase;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className="bg-bg-card border border-line rounded-xl p-5 w-full max-w-sm mx-4">
        {blockedMessage ? (
          <>
            <h3 className="text-ink font-semibold mb-2">Can&rsquo;t delete this yet</h3>
            <p className="text-ink-muted text-sm mb-4">{blockedMessage}</p>
            {error && <p className="text-down text-sm mb-4">{error}</p>}
            {onForceConfirm ? (
              <div className="flex justify-between gap-2">
                <button
                  className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-down text-bg hover:opacity-90 disabled:opacity-60"
                  onClick={handleForceConfirm}
                  disabled={busy}
                >
                  Delete anyway
                </button>
                <Button variant="secondary" onClick={handleCancel} disabled={busy}>OK</Button>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={handleCancel}>OK</Button>
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-ink font-semibold mb-2">{title}</h3>
            <p className="text-ink-muted text-sm mb-4">{description}</p>
            {phraseGated && (
              <div className="mb-4">
                <label className="text-ink-muted text-sm block mb-1.5">
                  Type <span className="text-ink font-semibold">{confirmPhrase}</span> to confirm.
                </label>
                <input
                  className="w-full bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-brand"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={confirmPhrase}
                  aria-label="Confirmation phrase"
                  autoFocus
                />
              </div>
            )}
            {error && <p className="text-down text-sm mb-4">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleCancel} disabled={busy}>Cancel</Button>
              <button
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-down text-bg hover:opacity-90 disabled:opacity-60"
                onClick={handleConfirm}
                disabled={busy || !phraseSatisfied}
              >
                {confirmLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
