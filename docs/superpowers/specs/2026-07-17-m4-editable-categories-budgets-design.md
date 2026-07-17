# M4 — Editable Categories, Budgets & Cash Entry — Design

**Status:** approved
**Date:** 2026-07-17
**Depends on:** M3 (`2026-07-16-m3-editable-transactions-design.md`) — DB-backed payload, PATCH-editable transactions, rules CRUD, categorization service.

## 1. Goal

Make the last read-only surfaces editable: categories get full CRUD, the Budgets page
edits real data (caps, rollover, mode, lines), manual "cash" transactions can be
created/edited/deleted, failed optimistic writes surface a toast instead of silently
reverting, and two small M3-deferred items land (rule keyword editing,
`Transaction.merchant` index).

Everything continues to flow through the `frontend/src/data/api.ts` seam and the
existing optimistic-update → refetch store pattern.

## 2. Decisions (user-approved)

| Question | Decision |
|---|---|
| M4 scope | All deferred candidates: categories & budgets, error toasts, rules keyword editing + merchant index, cash-entry transactions |
| Category delete with references | Always succeeds: transactions reassigned to `unclassified`, budget line deleted, rules targeting it deleted; response reports counts; UI confirm shows blast radius |
| Budget editing depth | Full inline editing on the Budgets page: caps, rollover, mode, add/remove lines; 50/30/20 bucket edited on the category (Settings) |
| Manual transaction lifecycle | Fully editable (all fields incl. bank facts) and deletable; bank rows keep M3 immutability |
| Cash account | Seeded dedicated Cash wallet (new `cash` kind); manual entries default to it but any account is selectable |
| Failed writes | Toast + auto-revert (refetch restores truth); no retry button |
| UI structure | Per-page: Categories card in Settings, inline editing on Budgets, add-transaction form on Transactions, global toast host |

## 3. Backend

### 3.1 Schema (rebuild required: delete `deeppocket.db`, re-run `uv run seed.py`)

- `Transaction.source: str = 'bank'` — `'bank' | 'manual'`. Seed and CSV import write
  `'bank'`; `POST /api/transactions` writes `'manual'`.
- `Transaction.merchant` becomes `Field(index=True)` (deferred M3 perf item — the
  categorization history scan queries it).

No other tables change; no new tables.

### 3.2 Seed — Cash wallet

`seed.py` creates one additional account when absent (idempotent):

- `id='cash_wallet'`, `kind='cash'`, `institution='Cash'`, `account_type=None`,
  `opening_balance=0.0`, `is_liability=False`, owners = both adults, no beneficiaries.
- `'cash'` is a new `AccountKind` value; it is a banking-side kind (like `chequing`)
  for payload grouping and balance math (opening balance + transactions).
- Purge `demo` restores it via reseed; purge `all` deletes it like any account.
  The `investments` purge mode spares it (it is a bank-side account).

### 3.3 Categories — new router `/api/categories`

- `POST /api/categories` — body `{name, group, bucket503020?, isEssential?}`.
  `id` = slugified name (lowercase, non-alnum → `_`, trimmed). Case-insensitive
  duplicate **name** or existing id → 409. `group` must be a valid `CategoryGroup`;
  `bucket503020` one of `needs|wants|savings` or null → else 422.
- `PATCH /api/categories/{id}` — body may set `name`, `group`, `bucket503020`,
  `isEssential` (extra fields → 422, `extra="forbid"` like M3 PATCH). Renaming to a
  name that case-insensitively collides with another category → 409. The `id` never
  changes (referenced by transactions/rules/budget lines).
- `DELETE /api/categories/{id}` — cascade semantics, always succeeds for non-protected
  categories:
  1. `UPDATE transaction SET category_id='unclassified' WHERE category_id=:id`
  2. `DELETE FROM budgetline WHERE category_id=:id`
  3. `DELETE FROM rule WHERE category_id=:id`
  4. delete the category row
  Response: `{deleted: true, transactionsReassigned: n, rulesDeleted: n, budgetLineDeleted: bool}`.
- **Protected category:** `unclassified` cannot be PATCHed or DELETEd (422 with a
  clear message) — the importer and categorization service depend on its id.
- 404 for unknown id on PATCH/DELETE.

### 3.4 Budget — new router `/api/budget`

- `PUT /api/budget/lines/{categoryId}` — body `{monthlyCap, rollover}`. Upsert: creates
  the line if absent (this is the "add category to budget" path). `monthlyCap` must be
  `>= 0` → else 422. Unknown categoryId → 404; `unclassified` → 422 (not budgetable).
- `DELETE /api/budget/lines/{categoryId}` — removes the line; 404 if absent.
- `PATCH /api/budget/config` — body may set `mode` (`envelope | zero_based |
  fifty_thirty_twenty`) and/or `targetSavingsRate` (0–1 float or null). Extra fields →
  422. Updates the single `BudgetConfig` row.

### 3.5 Transactions

- `POST /api/transactions` — body `{accountId, date, merchant, amount, categoryId?,
  notes?, tags?}` (`tags` is `list[str]`, stored JSON-encoded like M3). Validation: account must exist (404), date ISO `YYYY-MM-DD`,
  `amount != 0`, merchant non-empty. Sets `source='manual'`,
  `raw_merchant = merchant`, `person_id=None`, `running_total=None`, id = `txn_m_<uuid4hex12>`.
  If `categoryId` omitted/null → run the existing categorization service
  (history → rules → `unclassified`). Response: the created transaction in wire shape.
- `PATCH /api/transactions/{id}` — extended: when the row's `source == 'manual'`,
  additionally accept `date`, `merchant` (also updates `raw_merchant`), `amount`,
  `accountId` (must exist). When `source == 'bank'`, those fields keep the M3
  422-forbidden behaviour verbatim.
- `DELETE /api/transactions/{id}` — allowed only when `source == 'manual'`; bank rows
  → 422 ("bank-imported transactions cannot be deleted"); unknown id → 404.

### 3.6 Rules

- `PATCH /api/rules/{id}` — extended to accept `keyword` alongside the existing
  `categoryId`. New keyword is trimmed, must be non-empty, and a case-insensitive
  duplicate of another rule's keyword → 409 (same rule's own keyword unchanged is
  fine). `created_at` is untouched (precedence unchanged by edits).

### 3.7 Payload

`build_payload` adds `source` to each transaction dict. The Cash wallet flows through
the existing account serialization (computed name: owners + "Cash"). Additive only —
`lib/kpi.ts` / `lib/canadian.ts` untouched.

## 4. Frontend

### 4.1 Types & seam

- `types/index.ts`: `AccountKind` gains `'cash'`; `Transaction` gains
  `source: 'bank' | 'manual'`; request/response types for the new endpoints
  (`CategoryCreate`, `CategoryUpdate`, `CategoryDeleteResult`, `BudgetLineUpsert`,
  `BudgetConfigUpdate`, `TransactionCreate`, extended `TransactionUpdate`, extended
  `RuleUpdate`).
- `data/api.ts` (the seam — only fetch site): `createCategory`, `updateCategory`,
  `deleteCategory`, `upsertBudgetLine`, `deleteBudgetLine`, `updateBudgetConfig`,
  `createTransaction`, `deleteTransaction`; `updateRule` gains `keyword`.

### 4.2 Toasts

- Store slice: `toasts: Toast[]` (`{id: string, message: string}`), `pushToast(message)`,
  `dismissToast(id)`.
- `ToastHost` component (`components/shared/ToastHost.tsx`): fixed bottom-right stack,
  auto-dismiss after 6 s, manual ✕; mounted once in the app layout.
- One shared store helper wraps every optimistic write:
  apply optimistic state → call seam → on success refetch → on failure
  `pushToast("Couldn't save <what> — changes reverted")` + refetch.
  **Retrofit** the existing M3 actions (`reclassifyTransaction`, `editTransaction`,
  rule actions) onto the helper so behaviour is uniform.

### 4.3 Settings — Categories card

Sibling of the Categorization-rules card:

- Lists categories grouped by `group`; each row shows name, group, bucket, essential
  flag.
- Add form: name (required), group select, bucket select (none/needs/wants/savings),
  essential checkbox. 409 shown inline (same pattern as rules card).
- Inline edit of the same four fields per row.
- Delete opens the existing confirm-modal pattern; on confirm, calls the seam and the
  modal/toast reports the returned blast radius ("214 transactions → unclassified,
  2 rules deleted"). No type-to-confirm (that stays reserved for danger-zone purges).
- `unclassified` renders without edit/delete controls.
- Bucket (50/30/20) is edited here, not on the Budgets page — it is a category
  attribute.

### 4.4 Budgets page

- Mode tab writes `PATCH /api/budget/config` (optimistic; `budgetMode` store value now
  initializes from the payload and persists).
- Caps: click-to-edit inline number per row (Enter/blur commits via
  `upsertBudgetLine`, Esc cancels).
- Rollover checkbox writes through (`upsertBudgetLine`); the fake `localRollover`
  state is deleted.
- "Add category to budget" row: select of categories that have no line (excluding
  `unclassified` and `income`-group categories) + cap input → `upsertBudgetLine`.
- Per-row remove button (✕) → `deleteBudgetLine`.
- `targetSavingsRate` remains display-only (no screen currently edits it; YAGNI).

### 4.5 Transactions page — cash entry

- "Add transaction" button in the page header opens an inline form above the table:
  date (default today), account select (default Cash wallet), merchant text, amount
  (positive number + expense/income toggle → sign applied on submit), category select
  with an "Auto" default (omit categoryId → server categorizes), optional notes.
- Manual rows show a small `manual` badge next to the merchant.
- The existing expanded row editor, for manual rows only, additionally exposes date,
  merchant, amount, account — plus a Delete button with an inline confirm (two-click,
  no modal).
- Store actions: `addTransaction` (POST → refetch; not optimistic — the server
  assigns id/category), `removeTransaction` (optimistic remove → DELETE → refetch),
  `editTransaction` extended for manual-fact fields.

### 4.6 Rules card

- Keyword becomes inline-editable (same interaction as the category name inline edit);
  409 duplicate keyword shown inline like the existing create-form error.

## 5. Testing

**Backend (pytest, in-memory DB):**
- Categories: create + slug + 409 duplicate name (case-insensitive), PATCH fields +
  409 rename collision + 422 extra fields, DELETE cascade counts (transactions
  reassigned, rules deleted, budget line deleted), `unclassified` protection (422),
  404s.
- Budget: PUT upsert (create + update), cap validation, DELETE line + 404,
  PATCH config mode/targetSavingsRate + 422 invalid mode.
- Transactions: POST manual (explicit category + auto-categorize path + validation
  422s/404), PATCH manual facts editable / bank facts still 422, DELETE manual ok /
  bank 422 / unknown 404.
- Rules: PATCH keyword + trim + 409 dup + own-keyword no-op.
- Seed: cash wallet created, idempotent re-seed, purge `demo` restores it.
- Payload: `source` present; cash account serialized with computed name.

**Frontend (Vitest):**
- Toast slice: push/dismiss/auto-expiry.
- Store: optimistic helper reverts + toasts on failure (mock seam); new actions call
  the right seam methods.
- Existing suites stay green; `npm run build` (typecheck) gate.

**End-to-end:** live Playwright verification after implementation — create category →
budget it → cash entry auto-categorized → edit manual facts → delete category and
verify cascade on Transactions/Budgets → force a write failure (backend stopped) →
toast appears and UI reverts.

## 6. Out of scope (future candidates)

- Retry button on toasts; toast queue persistence.
- Editing `targetSavingsRate` in the UI.
- Category merge (delete currently reassigns to `unclassified` only).
- Splitting one transaction across categories.
- Multi-currency cash accounts.
