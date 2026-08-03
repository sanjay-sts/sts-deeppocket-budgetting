"""Derive an account's opening balance from a statement's running-total column.

Real bank exports carry the balance after every transaction, which makes the opening
balance a *computed* value rather than something the user has to look up and type. It also
gives the import a correctness check: if the running totals don't all imply the same opening
balance, some history is missing.

Sign conventions, which are the whole subtlety here:

* Internal `Transaction.amount` is negative for money going out, positive for money in.
* A statement's running total is a **cash balance** for chequing/savings/cash, but the
  **amount owed as a positive number** for a credit card (`mock/generate.py:828` and every
  real TD card export agree). `SIGN` below converts a reported total to an internal balance.
* `Account.opening_balance` stores cash on hand for cash kinds and amount owed (positive)
  for a card, matching what `lib/kpi.ts` expects from `meta.openingBalances`.

Derivation runs over the account's **whole** transaction set in the database, not just the
file being imported. Statements overlap and arrive in no particular order, so deriving from
one file's oldest row would be wrong the moment an earlier statement is imported.

## Why this votes instead of just reading the oldest row

Transactions carry a date but no intra-day sequence, and a statement routinely puts a dozen
rows on one date. So "the balance before the first transaction" is not computable from a
single row: which of that date's rows came first is unknowable, and the running totals of
the others sit at unknown points mid-day.

What IS order-independent is the total per *date*. For any date d, the balance at the end of
d is `opening + (sum of every amount on or before d)`, and that end-of-day balance is one of
the running totals reported on d. So each date proposes a small set of candidate openings,
and the true opening is the one every date agrees on. Dates that don't support the winner
are exactly the dates where history is missing, which is what gets reported as drift.
"""
from collections import defaultdict

from sqlmodel import Session, select

from ..models import Account, Transaction

# Reported running total -> internal balance.
SIGN = {"credit_card": -1.0}


def _sign(kind: str) -> float:
    return SIGN.get(kind, 1.0)


def derive_opening_balance(session: Session, account_id: str) -> dict | None:
    """Recompute and store `Account.opening_balance` for one account.

    Returns None when fewer than two dates carry a running total — one date can propose a
    candidate but nothing corroborates it, so any hand-entered opening balance stands.
    Otherwise returns the stored value plus how much history fails to reconcile. The caller
    commits.
    """
    account = session.get(Account, account_id)
    if account is None:
        return None

    txs = session.exec(select(Transaction).where(Transaction.account_id == account_id)).all()
    if not txs:
        return None

    amounts_by_date: dict[str, float] = defaultdict(float)
    totals_by_date: dict[str, list[float]] = defaultdict(list)
    for t in txs:
        amounts_by_date[t.date] += t.amount
        if t.running_total is not None:
            totals_by_date[t.date].append(t.running_total)

    dated_with_totals = sorted(totals_by_date)
    if len(dated_with_totals) < 2:
        return None

    sign = _sign(account.kind)

    # Each date proposes the openings consistent with the totals it reports.
    running = 0.0
    candidates_by_date: dict[str, set[float]] = {}
    for date in sorted(amounts_by_date):
        running += amounts_by_date[date]
        if date in totals_by_date:
            candidates_by_date[date] = {
                round(sign * rt - running, 2) for rt in totals_by_date[date]
            }

    # The winner is the opening the most dates agree on, ties broken toward the newest date
    # so that the CURRENT balance is the one that comes out right.
    support: dict[float, int] = defaultdict(int)
    for candidates in candidates_by_date.values():
        for c in candidates:
            support[c] += 1
    best = max(support.values())
    winner = next(
        c for date in reversed(dated_with_totals)
        for c in candidates_by_date[date]
        if support[c] == best
    )

    unreconciled = [d for d, cs in candidates_by_date.items() if winner not in cs]
    # Largest single unexplained gap, in the same owed/held orientation as the stored value.
    drift = max(
        (min(abs(c - winner) for c in candidates_by_date[d]) for d in unreconciled),
        default=0.0,
    )

    previous = account.opening_balance
    # Store in the per-kind convention meta.openingBalances documents.
    account.opening_balance = round(winner if sign > 0 else -winner, 2)
    session.add(account)

    return {
        "accountId": account.id,
        "openingBalance": account.opening_balance,
        "previousOpeningBalance": round(previous, 2),
        "drift": round(drift, 2),
        "unreconciledDates": len(unreconciled),
    }


def derive_opening_balances(session: Session, account_ids: set[str]) -> dict:
    """Recompute several accounts, returning what changed and what failed to reconcile.

    `openingBalances` lists every account whose stored opening balance moved — the user
    needs telling, because a statement's running total overrides a value they typed.
    `reconciliation` lists accounts with dates whose running totals can't be squared with
    the transactions on record, which means imported history has a gap.
    """
    changed: list[dict] = []
    drifted: list[dict] = []
    for account_id in sorted(account_ids):
        result = derive_opening_balance(session, account_id)
        if result is None:
            continue
        if result["openingBalance"] != result["previousOpeningBalance"]:
            changed.append(result)
        if result["unreconciledDates"]:
            drifted.append(result)
    session.commit()
    return {"openingBalances": changed, "reconciliation": drifted}
