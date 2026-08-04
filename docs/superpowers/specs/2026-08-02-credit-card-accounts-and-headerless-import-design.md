# Credit-card accounts and headerless CSV import — design

**Date:** 2026-08-02
**Branch:** `fix/credit-card-accounts`
**Status:** approved, ready for an implementation plan

## Why

A credit-card CSV import failed with 40 skipped rows, every one reporting
`unknown account: 'Sanjay TD AeroPlan Card' (must match an existing account id)`. The
account could not be created, because **no screen in the app can create a chequing,
savings, cash, or credit-card account.** `Accounts.tsx` is a read-only display grid, and
the only account editor — `InvestmentAccountsSection` in `Settings.tsx` — filters itself to
the seven investment kinds (`Settings.tsx:176`).

Looking at the 24 real TD exports that prompted this revealed a second, larger problem:
**21 of them have no header row at all**, so neither the header-sniffing auto-detector nor
the column-mapping wizard can read them. The one file that imported at all had a header
row and an `account` column added by hand — which is the workaround this design removes.

## The real data

Twenty-four TD exports, two raw shapes, no header row and no `account` column in either:

| Shape | Files | Columns | Notes |
|---|---|---|---|
| 5-column | 17 | `date, description, debit, credit, running_total` | chequing/savings **and** credit card share this layout |
| 4-column | 5 | `date, debit, credit, running_total` | **no description column at all** |

Date format varies per file — ISO (`2025-02-04`), `MM/DD/YYYY` (`09/19/2025`), and
`DD/MM/YYYY` (`30/04/2026`) — and so does row order: `(1)` is newest-first, `(20)` is
oldest-first. Every file carries a running total in its last column.

`running_total` is the bank's own balance after each transaction, and its meaning follows
the account kind, exactly as `mock/generate.py:828` already documents: a **cash balance**
for chequing/savings, and the **amount owed as a positive number** for a credit card.
Verified against `(1)`: `09/19/2025, TIM HORTONS, 2.82` debit reports `336.36` where the
prior row reports `333.54`.

Today that column is dead weight. It is stored end to end (`models.py:123`, `seed.py:185`,
the auto-detect importer) but **no frontend code reads it** — `types/index.ts:79` is the
only reference in `frontend/src` — and the wizard path throws it away outright
(`transactions_csv.py:213` hardcodes `running_total=None`).

## Scope

Four pieces. The first unblocks the original import; the rest are what the real files need.

### A. Account create / edit / delete for cash and credit kinds

The backend already has this: `POST`/`PUT`/`DELETE /api/accounts`
(`routers/accounts.py:58,84,134`) accept `kind` and `isLiability`, and `api.ts:62-87` plus
`useAppStore.ts:139-155` already wrap all three. The work is UI plus four backend holes.

**Backend**

- `constants.py` — add identity entries to `KIND_MAP` for `chequing`, `savings`, and
  `credit_card`. Today `normalize_kind("credit_card")` returns `non_registered`, which
  drops the account out of `BANK_KINDS` and therefore out of every cash and credit KPI.
  Leave `cash` mapping to `non_registered`: the investment importer relies on that, where
  `account_type: "cash"` means a cash/margin investment account.
- `routers/accounts.py` — force `is_liability = True` whenever the resolved kind is
  `credit_card`, on create and update. A card is never an asset, so this stops a client
  getting it wrong rather than trusting the flag.
- `schemas.py` / `routers/accounts.py` — add `openingBalance: Optional[float]` to
  `AccountCreate` and `AccountUpdate`, writing `Account.opening_balance` (a column that
  exists but that only `seed.py` has ever set). Omitted on create means `0.0`; omitted on
  update leaves it untouched.
- `services/deletion.py` + the delete route — `cascade_delete_account` currently deletes
  contributions, snapshots and join rows but **not** `Transaction` rows, and the
  non-cascade block check does not count them, so deleting a card today orphans its
  transactions. Add transactions to both, reporting `transactionCount` in the 409 detail.

**Frontend**

- New `components/shared/AccountForm.tsx` — one presentational form for a single account:
  owners via the existing `MultiSelect`, institution with a `datalist` of existing
  institutions, account type, kind `select`, optional name override whose placeholder is
  the `autoName()` preview (reusing `lib/account.ts`), and an opening-balance field shown
  only for bank kinds. Props cover both create and edit so the Accounts page and the
  Import callout share one implementation.
- `Accounts.tsx` — add / edit / delete for the **Cash accounts** and **Credit cards**
  groups, with per-group buttons ("Add credit card", "Add cash account") that preselect the
  kind. The Investment group links to the existing Settings editor instead of duplicating
  its RESP-beneficiary handling. Also drop the unused `MoneyCell` import at line 5.
- `api.ts` — export `AccountInput` (currently private) and add `openingBalance?: number`;
  tighten `useAppStore`'s loose `addAccount` signature (drops `isLiability`) and
  `editAccount: Record<string, unknown>`.
- `ConfirmDeleteModal.tsx:22` — add `transactionCount` to `COUNT_LABELS`, or a blocked
  delete renders the raw key name.

### B. Resolve the import's `account` column by name

`transactions_csv.py:105` and `:204` both do an exact primary-key lookup, so a
human-readable label can never match.

- One new `_resolve_account_id(index, label)` shared by the auto-detect and wizard paths:
  exact id, then trimmed case-insensitive `custom_name`, then the computed display name
  (`owners + institution + account_type`, matching `_account_out`). More than one hit
  raises `ambiguous account: {label!r} matches N accounts — use the account id`. The
  label → id index is built **once per import**, not per row.
- The summary gains `unknownAccounts: list[str]` (deduped, first-seen order) and
  `format: "bank" | "credit_card" | "mapped"`.
- `Import.tsx` — when `unknownAccounts` is non-empty, a callout lists each unmatched label
  with a **Create account** button opening `AccountForm` prefilled with `name` = the CSV
  label and the kind implied by `format`. On success the import re-runs with the file still
  in state, so the rows land without the CSV being touched. The hint text at lines 86-88
  becomes "must match an existing account's id or name".

### C. Headerless CSV support in the wizard

The auto-detect path is unchanged — it keeps sniffing known header sets. Headerless
handling lives in the wizard, which is where an unrecognised file already belongs.

- `preview_transactions_csv` — detect a missing header row and, when absent, return
  positional names `col1..colN` with the first row included as data. Detection: the file
  is treated as headerless when the first row looks like data, i.e. any cell parses as a
  date or two or more cells parse as amounts. That correctly classifies all 24 files —
  the TD exports lead with a date, while `account,date,merchant,…` and
  `date,spent,incoming,running total` contain no parseable date or amount.
- The response gains `headerless: bool`, surfaced in the wizard as a checkbox so a wrong
  guess is fixable, and echoed back in the mapping so the import interprets the file the
  same way the preview did.
- `TransactionCsvMapping` — add `headerless: bool = False` and make `merchantColumn`
  optional (it is currently required, and the 4-column shape has no description at all).
  `_validate_mapping` stops requiring it.
- `import_transactions_csv_mapped` — when `headerless`, read with `csv.reader` and
  synthesize `col1..colN` keys so the rest of the row loop is untouched.
- Missing merchant falls back to the literal `(no description)`. That interacts with dedup:
  the key is `(account_id, date, raw_merchant, amount)` (`_persist_row:51-56`), so two
  same-day same-amount rows with a constant merchant would wrongly collide — a real risk
  in a 474-row fee-heavy file. **Only when the merchant is the synthetic fallback**, add
  `running_total` to the dedup key. Narrow by design: widening it for all imports would
  break dedup across overlapping exports whose running totals differ.

### D. Running total → derived opening balance and reconciliation

- `TransactionCsvMapping` gains `runningTotalColumn: Optional[str]`, and the wizard path
  stores the parsed value instead of discarding it. The reported value is stored **as the
  bank reports it** (owed-positive for a card), matching what `generate.py` and `seed.py`
  already produce.
- After any transactions import, recompute `Account.opening_balance` for each bank-kind
  account touched, from the account's full transaction set in the DB — not just this file.
  That matters because these 24 files overlap and arrive in no particular order; deriving
  from one file's oldest row would be wrong as soon as an earlier statement is imported.

  Let `T` = the account's transactions ordered by `(date, id)`, `R` = the first with a
  running total, and `sign = -1` for `credit_card` else `+1` (converting a reported total
  to an internal balance, since internal amounts are negative for spending):

  ```
  opening_internal = sign * R.running_total - Σ(amount for u ≤ R)
  ```

  Stored as `opening_internal` for cash kinds, and negated for a credit card so the column
  holds **amount owed, positive**. Checked against the real rows: a chequing withdrawal of
  `63.69` reporting `41870.18` yields `41933.87`, the prior row's balance; a card purchase
  of `2.82` reporting `336.36` owed yields `333.54`.

  `Σ` runs over every transaction on the account, matching `kpi.ts`. Manual entries land in
  the Cash wallet account rather than an imported bank account, so they do not perturb this
  in practice.

- Reconciliation: for `N`, the last transaction carrying a running total, compare its
  reported value against `sign * (opening_internal + Σ(amount for u ≤ N))`. Report any
  drift of a cent or more in the summary as
  `reconciliation: [{accountId, accountName, expected, reported, drift}]`, rendered as a
  warning in `Import.tsx`. Only computed when at least two rows carry running totals.

- `kpi.ts` must actually consume the derived value, or it is silently discarded for cards:
  `latestCreditCardOwing:120-131` deliberately ignores `openingBalances`, and
  `netWorthTrend:301` clamps liabilities at zero. Owing becomes `opening_owed - delta`;
  the trend walk includes card openings. `latestCashBalances:106-118` already does the
  right thing.

**Consequence, stated plainly:** `meta.openingBalances` now carries a per-kind meaning —
cash on hand for chequing/savings/cash, amount owed for a credit card. That mirrors the
inversion `latestCreditCardOwing` already applies for display and is the price of a card
balance being correct when only part of its history is imported. It must be documented at
the definition site (`services/fixtures.py:181`) and in `types/index.ts`.

A statement's running total wins over a hand-entered opening balance, because it comes
from the bank. The import summary says so explicitly when it overwrites one.

## Testing

**Backend**

- `test_people_accounts.py` — create a credit-card account through the endpoint, with
  `kind` explicit and derived from `accountType`; `isLiability` forced true; an
  `openingBalance` round-trip; delete blocked by transactions, then cascading them.
- `test_transactions_csv.py` — resolution by custom name, by computed display name, and
  case-insensitively; ambiguous label raises; `unknownAccounts` and `format` populated.
- New `test_transactions_csv_headerless.py` — headerless detection on both real shapes;
  positional mapping; optional merchant with the `(no description)` fallback; dedup
  including `running_total` only in that case; idempotent re-import.
- New `test_opening_balance_derivation.py` — the two worked examples above; newest-first
  and oldest-first files; overlapping imports converging on the same opening balance;
  reconciliation drift reported; skipped when fewer than two running totals.

**Frontend**

- `api.test.ts` — `createAccount` sends `openingBalance`; the mapping carries
  `headerless` and `runningTotalColumn`.
- New `pages/__tests__/AccountsSection.test.tsx` — following `RulesSection.test.tsx`
  (named export, manual `createRoot`/`act`, `vi.mock` of `../../data/api`).
- `useAppStore` account-action tests, of which there are currently none.
- `kpi.test.ts` — card opening balance in `latestCreditCardOwing` and `netWorthTrend`,
  extending the existing `fxBreakdown()` fixture that already has a `credit_card` account.

**End to end**

Import `accountactivity (23).csv` unchanged: create the card from the Import callout, and
all 40 rows land. Then import a raw headerless file — `(1)` for the 5-column shape, `(20)`
for the 4-column `DD/MM/YYYY` shape — through the wizard against the same card, and
confirm the derived opening balance makes the Accounts page owing match the newest row's
running total.

## Out of scope

- Saved per-bank import profiles (remember a mapping by name) — [#1](https://github.com/sanjay-sts/sts-deeppocket-budgetting/issues/1).
- Positional sniffing in the auto-detect path, so a raw TD file imports in one click. The
  wizard covers these files; guessing column meaning with no header and no user
  confirmation is a separate decision.
- Editing cash/credit accounts from Settings. The Accounts page owns those kinds; Settings
  keeps investments.
