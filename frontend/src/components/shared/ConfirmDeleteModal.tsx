import { useState } from 'react';
import { Button } from '../ui/Button';
import { ApiError } from '../../data/api';

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
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
}: ConfirmDeleteModalProps) {
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function reset() {
    setBlockedMessage(null);
    setError('');
    setBusy(false);
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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className="bg-bg-card border border-line rounded-xl p-5 w-full max-w-sm mx-4">
        {blockedMessage ? (
          <>
            <h3 className="text-ink font-semibold mb-2">Can&rsquo;t delete this yet</h3>
            <p className="text-ink-muted text-sm mb-4">{blockedMessage}</p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleCancel}>OK</Button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-ink font-semibold mb-2">{title}</h3>
            <p className="text-ink-muted text-sm mb-4">{description}</p>
            {error && <p className="text-down text-sm mb-4">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleCancel} disabled={busy}>Cancel</Button>
              <button
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-down text-bg hover:opacity-90 disabled:opacity-60"
                onClick={handleConfirm}
                disabled={busy}
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
