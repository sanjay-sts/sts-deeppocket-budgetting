# TODO — M4: Editable Categories, Budgets & Cash Entry

**Branch:** `m4-editable-categories-budgets`
**Full task-by-task instructions (steps, code, tests):** `docs/superpowers/plans/2026-07-17-m4-editable-categories-budgets.md`
**Design spec:** `docs/superpowers/specs/2026-07-17-m4-editable-categories-budgets-design.md`

Work the unchecked tasks **in order**. Each task in the plan is TDD: write the failing
tests first, implement, run the full suite, commit with the message given in the plan.
Check the box here (and commit it) when a task lands.

- [x] Task 1: Schema — `Transaction.source`, merchant index, `cash` kind, Cash wallet seed (`c3a6a60`)
- [x] Task 2: Categories router — POST / PATCH / DELETE with cascade (`928ca9a`)
- [x] Task 3: Budget router — line upsert/delete, config patch (`f660d36`)
- [x] Task 4: Transactions — POST (manual), DELETE, PATCH extension for manual facts (`99eded7`)
- [x] Task 5: Frontend types, seam methods, and `cash`-kind plumbing (`36c3148`)
- [x] Task 6: Toast slice, ToastHost, store actions + retrofit (`a031602`)
- [ ] Task 7: Settings — Categories card (CRUD UI)
- [ ] Task 8: Budgets page — inline caps, persisted rollover, add/remove lines
- [ ] Task 9: Transactions page — cash entry, manual badge, manual editor + delete
- [ ] Task 10: Rules card — inline keyword editing (frontend only)
- [ ] Task 11: Docs + full sweep

Reminders (details in the plan's Global Constraints):

- Backend tests: `uv run pytest -q` from `backend/`. Frontend: `npx vitest run` +
  `npm run typecheck` from `frontend/`.
- Schema changed in Task 1 ⇒ after the milestone, delete `backend/deeppocket.db` and
  re-run `uv run seed.py`.
- The rules backend already supports keyword editing (`PUT /api/rules/{id}`) — Task 9/10
  frontend work only; do not rebuild it.
