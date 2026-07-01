# Force-delete ("Delete anyway") + Danger-zone purge

## Context / Problem

Removing data is tedious and, in bulk, impossible:

- Deleting an account or person is **blocked** whenever dependents exist (snapshots,
  contributions, owner/beneficiary links). The user must hunt down and delete each dependent
  by hand before the parent delete succeeds. There is no one-click "just remove all of it."
- There is **no bulk reset** — no way to wipe the investment domain, start from a blank
  slate, or restore the demo data without dropping to the CLI (`python seed.py`).

The backend already blocks deletes with structured 409 counts and has a seeder that supports
`demo` and `empty` investment modes — good foundations to build on.

## Goals

1. A **"Delete anyway"** (force / cascade) option on the individual account and person
   deletes that removes all dependents in one action, shown as a second button on the
   blocked-delete modal (the safe default — block + counts — is unchanged).
2. A **Danger zone** section in Settings with three bulk actions, each behind a
   **type-to-confirm** guard: clear investment data, clear everything, reset to demo.

## Non-Goals

- No undo / trash. Every action except "Reset to demo" is irreversible — that is *why*
  force-delete shows counts first and purge is type-to-confirm.
- No per-row multi-select ("check these 5 and delete") — the purge section covers bulk.
- No change to the default (non-force) delete behavior or its 409 shape.

## Architecture

### Backend

#### Cascade delete on the two delete endpoints
Add an optional query flag `cascade: bool = False` to `delete_account` and `delete_person`.
When `cascade` is false, behavior is exactly as today (block with the structured 409). When
true:

- **`delete_account?cascade=true`** — delete the account's `InvestmentSnapshot` rows,
  `Contribution` rows, `AccountOwner` rows, and `AccountBeneficiary` rows, then the `Account`.
- **`delete_person?cascade=true`** —
  1. Delete `AccountBeneficiary` rows for the person (unlink as beneficiary).
  2. Delete `Contribution` rows where `person_id == person` (contributions they made).
  3. For each account they own (`AccountOwner`): remove that owner row; then if the account
     now has **zero** remaining owners, delete that account via the same account-cascade above
     (its snapshots, contributions, beneficiaries, owners, and the account row).
  4. Delete the `Person`.

  A co-owned account survives (the person is just dropped as an owner); a solely-owned account
  is fully removed. Factor the account-cascade into a shared helper (e.g.
  `_cascade_delete_account(session, account_id)`) used by both endpoints.

#### Purge endpoint (new router `backend/app/routers/admin.py`)
`POST /api/admin/purge` with body `{ "mode": "investments" | "all" | "demo" }`:

- **`investments`** — delete all `Contribution`, `InvestmentSnapshot`, `AccountBeneficiary`,
  `AccountOwner`, `Account`. Keep `Person`.
- **`all`** — the above **plus** all `Person`.
- **`demo`** — delete everything editable (as in `all`), then repopulate by calling the
  existing `seed(session, investments="demo")` from `backend/seed.py`.

Deletion order respects the child→parent direction (contributions/snapshots and join rows
before accounts; accounts before people). Register the router in `app/main.py`. Return a
small summary (e.g. `{ "mode": ..., "ok": true }`).

### Frontend

#### `data/api.ts`
- `deleteAccount(id, cascade = false)` → `DELETE /api/accounts/{id}` + `?cascade=true` when set.
- `deletePerson(id, cascade = false)` → same.
- `purge(mode)` → `POST /api/admin/purge` with `{ mode }`.

#### `store/useAppStore.ts`
- `removeAccount(id, cascade?)` and `removePerson(id, cascade?)` gain the optional flag,
  forwarded to the api call; both still `refetch()` after.
- New `purgeData(mode)` → `api.purge(mode)` then `refetch()`.

#### `components/shared/ConfirmDeleteModal.tsx` (extend, don't fork)
Two additive props:

- `onForceConfirm?: () => Promise<void>` — when the confirm throws a structured blocked-delete
  409 and this prop is present, the blocked view renders a destructive **Delete anyway**
  button (alongside the existing dismiss) that calls `onForceConfirm`; on success the caller
  closes the modal. When absent, the blocked view is dismiss-only as today.
- `confirmPhrase?: string` — when set, the normal (non-blocked) view renders a text input and
  the destructive confirm button stays disabled until the typed value **exactly equals**
  `confirmPhrase`. Used by the danger zone. (These two props are independent; the danger zone
  uses `confirmPhrase`, the account/person deletes use `onForceConfirm`.)

The blocked-view guidance text already summarizes counts; keep that, and the **Delete anyway**
button sits beneath it so the user reads the impact before forcing.

#### Wiring
- **Settings → Household Remove** and **Investment-account Remove**: pass `onForceConfirm`
  that calls `removePerson(id, true)` / `removeAccount(id, true)`.
- **Investments → contribution / snapshot deletes**: no `onForceConfirm` (they have no
  dependents) — unchanged.
- **New `DangerZone` section** rendered at the bottom of `Settings` (its own `Card`, visually
  set apart with `border-down`/`text-down` accents). Three buttons, each opening
  `ConfirmDeleteModal` with an appropriate `confirmPhrase` (type the highlighted keyword) and
  `onConfirm` calling `purgeData('investments' | 'all' | 'demo')`. After a purge the store
  refetch repopulates; the section must not assume any data survives.

## Edge cases

- After **clear everything**, the app renders with an empty household/accounts — Settings and
  the KPI/derived screens must not crash on empty data (verify).
- Forcing a person delete that cascades solely-owned accounts can remove many snapshots and
  contributions; the modal's count summary comes from the existing 409 detail
  (`ownedAccountCount` / `beneficiaryAccountCount` / `contributionCount`) so the user sees it.
- `confirmPhrase` comparison is exact and case-sensitive to prevent accidental fires.

## Testing plan

- **pytest:**
  - `delete_account?cascade=true` removes snapshots + contributions + join rows + the account.
  - `delete_person?cascade=true`: unlinks beneficiary, deletes their contributions, drops them
    as owner, deletes a solely-owned account (and its data) but **keeps** a co-owned account.
  - `POST /api/admin/purge` for each mode: `investments` leaves people but zero accounts/
    snapshots/contributions; `all` leaves nothing; `demo` restores the seeded demo (accounts
    and people non-zero). Assert no orphaned owner/beneficiary rows remain after any of them.
- **Vitest:** `ConfirmDeleteModal` — `confirmPhrase` keeps the destructive button disabled
  until the input matches; the **Delete anyway** button appears only on a blocked-delete when
  `onForceConfirm` is provided.
- **Playwright (live):** force-delete an account that has snapshots; run **clear investment
  data**; **reset to demo**; confirm type-to-confirm gates the button.
