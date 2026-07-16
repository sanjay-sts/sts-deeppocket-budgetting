# Account name model + split editor columns

## Context / Problem

The Settings investment-account editor currently merges institution and account type into
one "Account" column, and the account's display name (`a.name`, shown on the Investments,
Accounts, and Dashboard screens and in dropdowns) is a stored string defaulted to
`"{institution} {accountType}"` at creation. Two problems:

1. The editor should show **Institution** and **Account type** as their own columns again.
2. The display name should default to **owner(s) + institution + account type**, be
   **overridable** with a custom name, and **stay in sync** — renaming a person, changing the
   type, or adding a co-owner should all update the name automatically (unless a custom name
   is set, which always wins).

## Goals

- Editor columns: **Name · Owner · Institution · Account type · Beneficiary · (Edit/Remove)**.
- Display name computed on read as `custom name` if set, else
  `"{owners joined by ', '} {institution} {accountType}"` (e.g. `Sanjay S, Anumol S WealthSimple TFSA`).
- An account stores only an optional **custom name** override — no stored default to go stale.
- The editor's Name field is optional; its placeholder previews the live auto-name.

## Non-Goals

- No change to how `a.name` is consumed on other screens — they keep reading the same field,
  now with a fresher (computed) value.
- No change to the natural-key/dedup rule (institution + type + owner set + beneficiary set).
- No new "name" column semantics beyond the custom override.

## Architecture

### Name model — computed, not stored (always in sync)

Replace the stored `Account.name: str` with an optional override
`Account.custom_name: Optional[str] = None`. The display name is computed **every time
accounts are serialized**:

```
display_name = custom_name or " ".join(filter(None, [
    ", ".join(owner_names),   # owners in stored order, comma-joined
    institution,
    account_type,
])).strip()
```

Because it's computed on each read from the current owners (names looked up live),
institution, and type, a person rename / type change / new co-owner all update the name
automatically. A custom name always wins. This is chosen over "recompute-and-store on save"
because that goes stale when a *person* is renamed.

### Backend changes

- **`models.py`** — `Account`: replace `name: str` with `custom_name: Optional[str] = None`.
- **`services/fixtures.py`**
  - `_account_out(a, owner_ids, beneficiary_ids, owner_names)` — add `owner_names`; return
    `name` = the computed display name, and `customName` = `a.custom_name` **only when set**
    (same optional-inclusion style as `beneficiaryIds`).
  - `build_payload` — build `names_by_id = {p.id: p.name for p in people}` and pass
    `owner_names = [names_by_id.get(pid, pid) for pid in owner_ids]` into `_account_out`.
- **`routers/accounts.py`**
  - `_out(session, a)` — look up owner names (in the same order as `_account_owner_ids`) and
    pass them to `_account_out`.
  - `create_account` — stop defaulting a name; set `custom_name = body.name or None`
    (drop the `name=` kwarg on `Account(...)`).
  - `update_account` — replace the `a.name = body.name` branch with
    `if body.name is not None: a.custom_name = body.name or None` (empty string clears the
    override, reverting to auto).
- **`seed.py`** — the account upsert currently sets `"name": a["name"]`; drop that key so
  seeded accounts use auto names (`custom_name` stays `None`).
- **`services/csv_import.py`** — the `Account(..., name=f"{institution} {account_type}")`
  construction drops the `name=` kwarg (auto name).
- **`schemas.py`** — unchanged; `AccountCreate.name` / `AccountUpdate.name` already exist and
  now carry the custom-name override.

### Frontend changes

- **`types/index.ts`** — add `customName?: string` to `Account` (keep `name`, now computed).
- **`pages/Settings.tsx` `InvestmentAccountsSection`**
  - Columns: **Name · Owner · Institution · Account type · Beneficiary · actions**.
  - Add `name` to the `form` and `draft` state.
  - A helper `autoName(personIds, institution, accountType)` =
    `[personIds.map(id → person name).join(', '), institution, accountType].filter(Boolean).join(' ')`,
    used as the **placeholder** for the Name input (live preview).
  - Read row: Name = `a.name`; Owner / Institution / Account type = raw values; Beneficiary
    stays RESP-only.
  - Edit row: Name input (value `draft.name`, placeholder = `autoName(draft…)`), Owner
    multi-select, Institution + Account type inputs, Beneficiary multi-select (RESP-only),
    Save/Cancel. `saveEdit` passes `name: draft.name` (empty clears the custom name).
  - Add row: Name input (optional, placeholder = `autoName(form…)`), then the existing Owner /
    Institution / Account type / Beneficiary controls. `addAccount` passes
    `name: form.name || undefined`. Keep the input examples and the recognized-types hint.
  - Edit init copies `name: a.customName ?? ''` into the draft so an existing custom name is
    editable and a blank means "auto".
- **store / api** — unchanged; `addAccount` / `editAccount` already forward `name`.

### Migration note

Replacing the `name` column with `custom_name` requires recreating the SQLite DB (delete
`deeppocket.db` + reseed, or a Danger-zone purge/reset) — same as prior schema changes this
session. Backend tests use an isolated DB (conftest), so they're unaffected.

## Testing plan

- **pytest:** create an account with no name → serialized `name` == `"{owner} {institution} {type}"`
  (comma-joined owners for a joint account) and `customName` absent; create/update with a name
  → `name` == custom and `customName` present; change owners via update → `name` recomputes;
  rename an owner via `PUT /api/people` → the account's `name` recomputes on the next read;
  update name to `""` → reverts to the auto name.
- **Vitest:** the `autoName` helper joins owners with `, ` and appends institution + type.
- **Playwright (live):** the 5-column layout renders; a joint account shows the comma-joined
  name; setting a custom name overrides it and clearing it reverts to auto.
