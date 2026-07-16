# Account owner/beneficiary multi-select + inline edit

## Context / Problem

The **Investment accounts** section (Settings) has two usability gaps:

1. The **Owner** and **RESP beneficiary** columns render always-open vertical checkbox
   lists inside table cells. In the add-account row these tall cells sit next to single-line
   Institution / Account-type inputs, so the row looks cluttered and misaligned.
2. There is **no way to edit an existing account's owners or beneficiaries** — the only
   actions on a row are *Remove* (delete the whole account). The backend already supports
   partial account edits (`update_account` accepts `personIds` / `beneficiaryIds`) and the
   store already exposes `editAccount`, but **nothing in the UI calls it** (dead code).

Consequence of (2): a person who is an RESP beneficiary can never be removed as *just* a
beneficiary, so deleting that person is permanently blocked by the `delete_person` 409
("This still has 1 beneficiary account. Remove those first.") with no UI to actually do the
removal short of deleting the entire RESP account (and its snapshots).

## Goals

- A reusable multi-select **dropdown-with-checkboxes** control, used for Owner and RESP
  beneficiary, replacing the checkbox columns in the add-account row.
- **Inline Edit** on each existing account row to change institution, account type, owners,
  and beneficiaries, saved via the already-wired `editAccount`.
- As a direct result: removing a person as a beneficiary (via account edit) unblocks
  deleting that person.

## Non-Goals

- No backend or DB changes — `update_account` already does everything needed.
- No change to the blocked-delete message wording (covered by the prior deletion-UX work).
- No changes to `mock/generate.py`.
- No multi-select on the Contributions form (out of scope for this change).

## Architecture

### `components/ui/MultiSelect.tsx` (new)

```ts
interface MultiSelectProps {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}
```

- A wrapper `<div className="relative">`.
- A trigger button styled like the existing inputs
  (`bg-bg-elev border border-line rounded-md px-3 py-1.5 text-sm text-ink`) showing the
  selected labels joined by `", "`, or the `placeholder` in `text-ink-dim` when empty.
- When open, an absolutely-positioned popover (`absolute z-20 mt-1 bg-bg-card border
  border-line rounded-md`) with one `<label>` + checkbox (`accent-brand`) per option.
- Toggling an option calls `onChange` with the id added/removed — the popover **stays open**
  so several can be picked.
- Click-outside closes it: a `document` `mousedown` listener attached only while open (via
  `useEffect` keyed on open state) and a container `ref`; the listener is removed on cleanup.
- `disabled` renders the trigger non-interactive.

### `pages/Settings.tsx` — `InvestmentAccountsSection`

**Add-account row:** replace the two checkbox `<div>` cells with `<MultiSelect>` — owners
over all household members, beneficiaries over the kids. Submit validation is unchanged
(`personIds.length && institution && accountType`).

**Existing rows:** add local state `editingId: string | null` and a `draft`
`{ personIds, institution, accountType, beneficiaryIds }`.

- When `editingId === a.id`, the row renders editable cells: Owner and RESP-beneficiary
  become `<MultiSelect>`, Institution and Account-type become text inputs (Institution keeps
  its `datalist`), Kind stays a read-only display of `a.kind`, and the actions cell shows
  **Save / Cancel**.
- **Edit** click initializes the draft from the account (`personIds = a.ownerIds`,
  `institution`, `accountType`, `beneficiaryIds = a.beneficiaryIds ?? []`) and sets
  `editingId = a.id`.
- **Save** calls `editAccount(a.id, { personIds, institution, accountType, beneficiaryIds })`,
  then clears `editingId` on success; errors (e.g. a natural-key 409) surface via the
  existing inline `error` string. Save is disabled when `draft.personIds.length === 0`.
- **Cancel** clears `editingId` and the error.
- Non-editing rows render read-only cells plus **Edit** and **Remove** actions (Remove keeps
  its existing confirm-modal wiring).

Kind is not directly edited; the backend re-derives it from `accountType` on save, and the
row reflects the new value after the store refetch.

## Testing plan

- **Vitest** unit test for `MultiSelect`: shows the placeholder when nothing is selected,
  shows joined labels when ids are selected, and toggling an option fires `onChange` with the
  correctly added/removed id.
- `npm run typecheck` and `npm run build` clean; `npm test` green.
- **Manual / Playwright** against live servers: (a) add an account using the dropdown
  pickers; (b) Edit the Questrade RESP, uncheck a beneficiary, Save, and confirm the row
  updates; (c) then delete that kid in Household and confirm it now succeeds; (d) verify the
  Cancel path on an edit leaves the account unchanged.
