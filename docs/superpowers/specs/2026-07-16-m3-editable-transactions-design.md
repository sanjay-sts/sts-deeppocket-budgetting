# Milestone 3 — Editable Banking & Transactions

- **Date:** 2026-07-16
- **Status:** Approved (design), pending spec review
- **Branch:** `m3-editable-transactions`
- **Supersedes/Extends:** Milestone 2 (FastAPI backend, editable investment domain)

## 1. Context & Problem

M2 made the **investment** domain (people, accounts, snapshots, contributions) fully
editable and persistent, but the **banking** domain is still frozen: the 864 mock
transactions, the 7 bank/credit-card accounts, categories, and budget caps all come from
`mock/out/fixtures.json`, merged into `GET /api/data` at request time by
`services/fixtures.build_payload`. Consequences:

- `reclassifyTransaction` is **in-memory only** — a category fix is lost on reload.
- Real bank/credit-card CSV exports cannot be imported; the Import page handles
  investments only.
- There is no auto-categorization: the old fixtures rules engine was dead code and was
  removed in issue #6, with the intent to rebuild it properly when transactions became
  editable (this milestone).
- The backend carries a permanent runtime dependency on a generated mock file, and
  `build_payload` maintains an awkward split: DB accounts vs `BANK_KINDS` fixture accounts.

M3 completes the M2 story: **everything served by `/api/data` lives in SQLite**, the
fixtures file becomes seed input only, transactions become editable (scoped — see Goals),
bank/credit-card CSVs import with dedup, and categorization is driven by user history and
user-editable rules.

## 2. Goals

1. **Full cutover to the DB (approach A).** `seed.py` ingests all of `fixtures.json`
   (bank accounts, transactions, categories, budget) alongside the existing
   people/investment seeding; `build_payload` composes 100% from the DB. The
   `FIXTURES_PATH` runtime dependency and the `BANK_KINDS` account split are deleted.
   The wire shape of `/api/data` (the `Fixtures` type) is unchanged, so screens and the
   pure `lib/` pipeline keep working untouched.
2. **Persisted transaction edits, scoped.** Editable: `categoryId`, `isTransfer`,
   `isDuplicate`, `notes`, `tags`. **Not** editable: date, amount, merchant, account —
   those are bank facts; editing them invites drift from source statements.
3. **Bank & credit-card CSV import** with header auto-detection of the two real formats
   already sampled in `mock/out/` (see §6), idempotent dedup, and per-row error reporting.
4. **Auto-categorization**: merchant-history match → user-editable keyword rules →
   `unclassified` fallback. Reclassifying in the UI offers one-click rule creation
   ("Always categorize X as Y?").
5. **Rules management UI** in Settings (list / add / edit / delete).
6. Tests for every new surface (pytest + Vitest), plus live Playwright verification.

## 3. Non-Goals (this milestone)

- **Full transaction CRUD.** No manual add/delete of transactions, no editing of bank
  facts (date/amount/merchant/account). Cash-spending entry is a possible M4.
- **Editable categories or budgets.** Both move into the DB (single source of truth,
  FK targets for rules/transactions) but get **no editing UI or endpoints** yet —
  natural M4 candidates.
- **Configurable column-mapping import wizard** (per-bank import profiles). The two
  auto-detected formats cover the household's real exports; new formats are added in code.
- ML/embedding categorization; auth/multi-user; cloud deployment (unchanged from M2).

## 4. Architecture

```
backend/
  app/models.py             + Category, Transaction, Rule, BudgetLine, BudgetConfig,
                              AppMeta; Account gains opening_balance
  app/constants.py          + CRA_LIMITS_2025 (moved from fixtures — it's law, not data);
                              normalize_date learns MM/DD/YYYY
  app/routers/
    transactions.py         PATCH /api/transactions/{id}
    rules.py                CRUD /api/rules
    imports.py              + POST /api/import/transactions-csv
  app/services/
    fixtures.py             build_payload reads ONLY the DB; _load_base()/FIXTURES_PATH
                            deleted from the request path
    transactions_csv.py     sniff format, normalize, dedup, categorize, insert
    categorize.py           shared pipeline: history -> rules -> unclassified
  seed.py                   also seeds bank accounts, transactions, categories, budget,
                            app meta (idempotent, as today)

frontend/src/data/api.ts    + updateTransaction, listRules/createRule/updateRule/
                              deleteRule, importTransactionsCsv
frontend/src/store/useAppStore.ts
                            reclassifyTransaction: optimistic local update, then PATCH +
                            refetch; + rule actions, + transaction-CSV import action
frontend/src/pages/Transactions.tsx
                            category dropdown persists; inline "always do this?" rule
                            prompt after reclassify; row expands for notes/tags/flags
frontend/src/pages/Settings.tsx
                            + "Categorization rules" card
frontend/src/pages/Import.tsx
                            + "Import transactions CSV" card
```

**Why this shape.** Same proof as M2: because `/api/data` keeps its shape, the cutover is
invisible to the 10 screens and to `kpi.ts`/`canadian.ts`. All new writes flow through the
`api.ts` seam and the store's existing mutate-then-refetch pattern. Categorization lives in
one backend service used by both the importer and (for rule preview counts, if needed) the
rules router — never in frontend components.

## 5. Data Model

New tables (editable in **bold**):

- **`transaction`**: `id` (pk), `account_id` (fk, indexed), `date` (ISO string, indexed),
  `raw_merchant`, `merchant`, `amount` (float; **expense < 0, inflow > 0**),
  `category_id` (fk), `person_id` (nullable fk), `is_transfer` (bool, default false),
  `is_duplicate` (bool, default false), `notes` (nullable str),
  `tags` (nullable str, JSON-encoded list), `running_total` (nullable float, as-imported).
  Editable fields: `category_id`, `is_transfer`, `is_duplicate`, `notes`, `tags` only.
  **No uniqueness constraint** on (account, date, merchant, amount) — two identical
  purchases in one day are legitimate; dedup is an import-time check (§6), not a DB rule.
- **`rule`**: `id` (pk), `keyword` (str, matched case-insensitively as a substring
  against `raw_merchant` and `merchant`), `category_id` (fk), `created_at` (ISO
  timestamp). Precedence: **newest rule first, first match wins** — a fresh correction
  beats a stale rule. Duplicate keyword (case-insensitive) → 409.
- `category`: `id` (pk), `name`, `group`, `bucket503020` (nullable), `is_essential`
  (bool). Seeded from fixtures; **no CRUD this milestone**. The seeded set includes
  `unclassified` (the categorization fallback) and the `transfers` group
  (`transfer`, `cc_payment`).
- `budgetline`: `category_id` (pk/fk), `monthly_cap` (float), `rollover` (bool).
- `budgetconfig` (one row): `id` (pk), `mode`, `target_savings_rate` (nullable).
- `appmeta`: key-value (`key` pk, `value` str) for `generatedAt`, `seed`,
  `monthsCovered` — keeps `/api/data`'s `meta` block alive without the file.
- `account` gains `opening_balance` (float, default 0), absorbed from
  `meta.openingBalances` at seed time. `meta.openingBalances` in the payload is rebuilt
  from this column (it is load-bearing for cash-balance math in `lib/kpi.ts`).
- `craLimits` served from `CRA_LIMITS_2025` in `app/constants.py`.

**Seeding.** `seed.py` (and `purge mode=demo`) ingest the full `fixtures.json`: 7 bank
accounts (owners via the existing `AccountOwner` join table; `is_liability=True` for
credit cards; fixture account IDs like `sanjay_chequing` kept verbatim — the sample CSVs
reference them), 864 transactions, 30 categories, budget lines/config, app meta.
`purge mode=all` wipes the new tables too; `mode=investments` is unchanged (banking data
survives). The rules table starts **empty** — seeded transactions are already categorized,
so history matching covers known merchants from day one.

## 6. CSV Import (`services/transactions_csv.py`)

**Format sniffing** by lower-cased header set:

| Format | Required headers | Sign normalization |
|---|---|---|
| Bank | `date, transaction_detail, withdrawal, deposit, running_total, account` | `withdrawal` → negative, `deposit` → positive |
| Credit card | `date, merchant, amount, payment, running_total, account` | `amount` (charge) → negative, `payment` → positive |

Neither header set matches → row-0 error naming both accepted formats (same pattern as
the investments importer).

Per row:

1. **Date**: `MM/DD/YYYY` (the real export format), `YYYY-MM-DD`, or `YYYYMMDD` →
   ISO. Bad date → row error.
2. **Account**: the `account` column must equal an existing `Account.id`
   (sample slugs *are* the IDs). Unmatched → row error. **Never auto-creates** a bank
   account — institution/owner can't be inferred from a slug (deliberate contrast with
   the investments importer, where the CSV carries person + institution).
3. **Amount**: exactly one of the two amount columns non-empty; parse and sign per the
   table above. Both/neither/non-numeric → row error.
4. **Merchant**: `raw_merchant` = the raw detail verbatim; `merchant` = title-cased
   cleanup (same normalization the mock generator applies).
5. **Dedup**: if a transaction with identical (`account_id`, `date`, `raw_merchant`,
   `amount`) already exists, skip the row and count it under `duplicates` —
   re-importing overlapping statement ranges is safe and idempotent.
6. **Categorize** (§7) and insert. If the landed category is in the `transfers` group,
   set `is_transfer=True`.

**Summary** (superset of the investments importer's shape):
`{created, duplicates, skipped, errors: [{row, reason}], categorized: {history, rules, unclassified}}`.
`skipped` counts error rows; `duplicates` counts dedup skips; the `categorized` split
shows how well auto-categorization performed.

## 7. Categorization Pipeline (`services/categorize.py`)

For each imported transaction, in order — first hit wins:

1. **History**: the most recent existing transaction (by date, then insertion order)
   whose normalized `merchant` matches exactly → copy its `category_id`.
2. **Rules**: case-insensitive substring match of each rule's `keyword` against
   `raw_merchant` and `merchant`, newest rule first.
3. **Fallback**: `unclassified`.

The pipeline is a pure-ish service function (session in, category id out) so pytest can
exercise precedence directly.

## 8. API

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/api/transactions/{id}` | Partial update; accepts any subset of `categoryId`, `isTransfer`, `isDuplicate`, `notes`, `tags`. 404 unknown tx; 422 unknown category or non-editable field present. |
| GET/POST | `/api/rules` · PUT/DELETE `/api/rules/{id}` | Rules CRUD. 422 empty keyword / unknown category; 409 duplicate keyword. |
| POST | `/api/import/transactions-csv` | Multipart upload → summary (§6). |

PATCH (not PUT) is deliberate: the resource is only partially writable by design.
Existing endpoints are untouched; `GET /api/data` response shape is byte-compatible in
structure with M2 (same keys, `rules` intentionally **not** included — rules are
management data with their own endpoint, not render data).

## 9. Features (UX)

1. **Transactions page** — the existing category dropdown now persists (optimistic local
   update, then `PATCH` + refetch — instant UX that survives reload). After a
   reclassify, an inline prompt: *"Always categorize 'COSTCO WHOLESALE W1283' as
   Groceries?"* — one click creates a rule (keyword prefilled with the merchant, editable
   later in Settings). A transaction row expands to edit notes, tags, and the
   transfer/duplicate flags.
2. **Settings — Categorization rules card**: table of keyword → category with inline
   add / edit / delete. Shows rule count in the card subtitle.
3. **Import page — Import transactions CSV card**: file picker next to the existing
   investments-import card; on completion shows the full summary including the
   categorized split and per-row errors. (Superseded from an earlier Settings-card plan —
   the app already has a dedicated Import page, so the card lives there instead.)

## 10. Testing

- **pytest:** seed ingests banking domain (counts, opening balances, IDs preserved);
  `/api/data` payload composed with the fixtures file removed/renamed (no runtime read);
  payload shape parity vs M2 keys; transaction PATCH (each editable field, 404, 422 on
  bad category, 422 on attempt to change `amount`); rules CRUD incl. 409 duplicate;
  import — both formats detected, sign conventions, MM/DD/YYYY dates, unknown account
  row error, dedup idempotency (import same file twice → all `duplicates`),
  categorization precedence (history > rule > unclassified), transfers-group sets
  `is_transfer`.
- **Vitest:** store `reclassifyTransaction` persists via mocked seam (optimistic update
  + PATCH called + refetch); rules card and import-summary components (existing
  `createRoot` + `act` pattern).
- **Live verification (Playwright):** reclassify → reload → category sticks; create rule
  via inline prompt → import sample `credit_card.csv` → matching rows auto-categorized;
  re-import same file → all duplicates; Settings rules CRUD round-trip.

## 11. Sequencing (becomes the implementation plan)

1. **Schema + seed**: new tables, `opening_balance`, `CRA_LIMITS_2025`, seed ingests
   banking domain. **Exit:** `uv run seed.py` populates everything; pytest green.
2. **Payload cutover**: `build_payload` DB-only; delete `_load_base` from the request
   path. **Exit:** all 10 screens render identically from the DB (seam proven again).
3. **Transaction PATCH + frontend persistence**: endpoint, `api.ts`, store, Transactions
   page persistence. **Exit:** reclassify survives reload.
4. **Rules**: model already in (step 1), CRUD endpoints, Settings card, inline
   rule-creation prompt on reclassify.
5. **Transaction CSV import**: sniffer/normalizer/dedup/categorizer service, endpoint,
   Settings import card.
6. Tests throughout (each step lands with its tests); final live Playwright pass;
   CLAUDE.md known-gaps refresh.

## 12. Open Questions (resolved during design)

- ~~What happens to mock data?~~ → Seed the DB from fixtures; `purge → demo` restores.
- ~~Edit scope?~~ → Reclassify + flags + notes/tags; bank facts immutable.
- ~~CSV formats?~~ → The two sampled formats, auto-detected; mapping wizard deferred.
- ~~Categorization?~~ → History → editable rules → `unclassified`, with rule suggestion
  on reclassify.
- ~~Categories/budget?~~ → Into the DB, read-only; editing UI deferred to M4.
