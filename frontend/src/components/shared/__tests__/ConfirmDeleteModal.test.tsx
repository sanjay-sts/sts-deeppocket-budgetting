import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmDeleteModal } from '../ConfirmDeleteModal';
import { ApiError } from '../../../data/api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll('button')].find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined;
}

// Set an input's value the way React's synthetic onChange expects (native setter + input event).
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ConfirmDeleteModal', () => {
  it('keeps the destructive button disabled until the typed phrase matches exactly', () => {
    render(
      <ConfirmDeleteModal
        open
        title="Clear everything?"
        description="This wipes it all."
        confirmPhrase="ERASE"
        onConfirm={async () => {}}
        onCancel={() => {}}
      />,
    );

    const confirm = buttonByText('Delete')!;
    const input = container!.querySelector('input') as HTMLInputElement;
    expect(confirm.disabled).toBe(true);

    // Partial match — still disabled.
    setInputValue(input, 'ERAS');
    expect(confirm.disabled).toBe(true);

    // Wrong case — comparison is case-sensitive, still disabled.
    setInputValue(input, 'erase');
    expect(confirm.disabled).toBe(true);

    // Exact match — now enabled.
    setInputValue(input, 'ERASE');
    expect(confirm.disabled).toBe(false);
  });

  it('shows "Delete anyway" when onConfirm rejects with a blocked-delete ApiError and onForceConfirm is provided', async () => {
    const blocked = new ApiError(409, 'Conflict', {
      detail: { message: 'blocked', snapshotCount: 2, contributionCount: 1 },
    });
    const onConfirm = vi.fn().mockRejectedValue(blocked);
    const onForceConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDeleteModal
        open
        title="Remove account?"
        description="Permanently delete."
        onConfirm={onConfirm}
        onForceConfirm={onForceConfirm}
        onCancel={() => {}}
      />,
    );

    // No "Delete anyway" until the blocked delete surfaces.
    expect(buttonByText('Delete anyway')).toBeUndefined();

    await act(async () => {
      buttonByText('Delete')!.click();
      // Let the rejected onConfirm settle and the blocked state flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(buttonByText('Delete anyway')).toBeTruthy();
  });

  it('does not leak a prior blocked view into the next open of the same mounted modal', async () => {
    const blocked = new ApiError(409, 'Conflict', {
      detail: { message: 'blocked', snapshotCount: 2 },
    });
    const props = {
      open: true,
      title: 'Remove account A?',
      description: 'Permanently delete.',
      onConfirm: vi.fn().mockRejectedValue(blocked),
      onForceConfirm: vi.fn().mockResolvedValue(undefined),
      onCancel: () => {},
    };
    render(<ConfirmDeleteModal {...props} />);

    await act(async () => {
      buttonByText('Delete')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The blocked view is showing after the rejected confirm.
    expect(buttonByText('Delete anyway')).toBeTruthy();

    // Close the still-mounted modal (as a caller does after a force-delete success).
    act(() => root!.render(<ConfirmDeleteModal {...props} open={false} />));
    // Reopen for a different, dependency-free row: must be a fresh confirm, not the stale
    // blocked view.
    act(() =>
      root!.render(
        <ConfirmDeleteModal
          open
          title="Remove account B?"
          description="Permanently delete."
          onConfirm={async () => {}}
          onForceConfirm={async () => {}}
          onCancel={() => {}}
        />,
      ),
    );

    expect(container!.textContent).toContain('Remove account B?');
    expect(buttonByText('Delete anyway')).toBeUndefined();
    expect(buttonByText('Cancel')).toBeTruthy();
  });
});
