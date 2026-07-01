# Deletion UX design

## Context / Problem

DeepPocket has four delete actions in the app:

1. Settings → Household → Remove person
2. Settings → Investment accounts → Remove account
3. Investments → Contributions → Delete contribution
4. Investments → Snapshots → Delete snapshot (**not wired at all** — `removeSnapshot` is
   imported in `SnapshotEditor` but never called from a button)

None of the four ask for confirmation before deleting. Two of them (person, account) are
also guarded server-side: the backend returns a `409` when the row has dependents (a person
who still owns an account, an account that still has snapshots/contributions), but the
error message is a single opaque sentence with no counts, and the frontend doesn't parse or
show it distinctly from any other failure — the user just sees a generic thrown error.
This was surfaced when the user hit both 409s directly via the API and asked what they meant.

## Goals

- Every delete action (all 4) asks for confirmation before deleting, with a clear warning
  that the action is irreversible.
- When a delete is blocked by the backend because dependents exist, the user sees *why*,
  with counts (e.g. "this account still has 3 snapshots and 12 contributions"), not a raw
  error string.
- Snapshot delete actually works end-to-end (currently dead code).
- One reusable confirmation modal, not four bespoke ones.

## Non-Goals

- No cascade/force-delete option (e.g. "delete this account and all its snapshots"). Blocked
  deletes require the user to remove dependents first, manually, as today.
- No cross-page deep link ("Go to snapshots →") from a blocked-delete message. The message
  states counts; navigating there is left to the user.
- No change to which entities are deletable or the underlying 409 business rules — this is
  purely about surfacing existing rules more clearly and adding confirmation.

## Architecture

### 1. `ApiError` class (`frontend/src/data/api.ts`)

The `json<T>` helper currently throws a plain `Error` built from `res.status` and the raw
response text, discarding structure. Replace with:

```ts
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body && 'detail' in (body as any)
      ? String((body as any).detail)
      : String(body));
    this.status = status;
    this.body = body;
  }
}
```

`json<T>` parses the response body as JSON when possible (falling back to text) and throws
`ApiError` instead of `Error`. Callers that only read `.message` keep working unchanged;
callers that care about structured detail can check `e instanceof ApiError` and read
`e.status` / `e.body`.

### 2. Backend: structured 409 detail

`HTTPException(409, detail=...)` currently takes a string. Change both delete endpoints to
pass a dict, so the frontend can read counts directly instead of parsing prose.

`backend/app/routers/accounts.py::delete_account` — when blocked:

```json
{
  "detail": {
    "message": "This account still has dependent data. Remove it first.",
    "snapshotCount": 3,
    "contributionCount": 12
  }
}
```

`backend/app/routers/people.py::delete_person` — when blocked:

```json
{
  "detail": {
    "message": "This person still has dependent data. Remove it first.",
    "ownedAccountCount": 1,
    "beneficiaryAccountCount": 2,
    "contributionCount": 5
  }
}
```

Counts are computed with `len(session.exec(select(...).where(...)).all())`, matching the
existing query style in these two files, instead of `.first()`, since we now need the number,
not just existence.

### 3. `ConfirmDeleteModal` component (new, `frontend/src/components/shared/ConfirmDeleteModal.tsx`)

A single reusable modal, dark-themed consistent with the rest of the app
(`bg-bg-card`, `border-line`, `text-ink`, destructive action in `text-down` / a solid
down-colored button).

Props:

```ts
interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;            // e.g. "Remove Sanjay S?"
  description: string;      // e.g. "This will permanently delete this household member."
  confirmLabel?: string;    // default "Delete"
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}
```

Behavior:

- Renders nothing when `open` is false.
- Shows title + description + Cancel / Delete buttons.
- On confirm, calls `onConfirm()`; if it throws an `ApiError` with a structured `body.detail`
  object, the modal swaps its content to a **blocked-delete message**: no destructive button,
  just the dependent counts in plain language and a single "OK" dismiss button (this is the
  "clear guidance only" outcome the user selected — no forced navigation, no retry loop).
- On confirm success, calls nothing further; the caller's own store action already triggers
  a refetch (existing `api.ts` seam behavior), and the caller closes the modal.
- Any other error (network, 404, etc.) is shown as a plain inline error string, matching how
  errors are already surfaced elsewhere in Settings/Investments, and the modal stays open so
  the user can cancel.

### 4. Wiring the four call sites

Each site gets local `useState` for "which row is pending delete" (or a boolean for
single-target sections) and renders one `<ConfirmDeleteModal>` per section, reusing the
existing `error` state pattern already present in `Settings.tsx`.

- **Settings → Household Remove** (`HouseholdSection`): clicking Remove opens the modal
  instead of calling `removePerson` directly; confirm calls `removePerson(p.id)`.
- **Settings → Investment accounts Remove** (`InvestmentAccountsSection`): same pattern with
  `removeAccount(a.id)`.
- **Investments → Contributions Delete** (`ContributionsEditor`): same pattern with
  `removeContribution(e.id)`, replacing the current direct-call button.
- **Investments → Snapshots Delete** (`SnapshotEditor`): this one needs a data-shape fix
  first. The snapshot rows currently rendered in this editor come from the consolidated
  fixtures payload, which has no stable per-row `id` to delete by. Wire the editor to fetch
  via the existing-but-unused `listSnapshots(accountId)` (already implemented in `api.ts`,
  returns `SnapshotRow[]` with `id`), and use those ids for both display and the delete
  button → confirm modal → `removeSnapshot(id)`.

## Testing plan

- **Backend (pytest):** assert the blocked-delete 409 responses for both `delete_account`
  and `delete_person` return the structured dict shape with correct counts, for at least one
  case with dependents on each countable field.
- **Frontend (Vitest):** unit test `ApiError` — given a `Response`-like 409 with a JSON body,
  confirms `.status` and `.body` are populated and `instanceof ApiError` holds.
- **Manual / Playwright:** for each of the 4 sites, verify (a) clicking Remove/Delete opens
  the modal rather than deleting immediately, (b) Cancel leaves data untouched, (c) Confirm
  on a deletable row removes it and closes the modal, (d) Confirm on a blocked row (e.g. an
  account with snapshots) shows the counts message instead of deleting, consistent with how
  prior UI work this session was verified live in the browser.
