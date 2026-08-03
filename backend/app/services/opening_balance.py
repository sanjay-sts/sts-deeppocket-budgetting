"""Derive an account's opening balance from a statement's running-total column.

Real bank exports carry the balance after every transaction, which makes the opening
balance a *computed* value rather than something the user has to look up and type. It also
gives the import a free correctness check: walk the transactions forward from the derived
opening and the last running total should come back out.

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
"""
from sqlmodel import Session, select

from ..models import Account, Transaction

# Reported running total -> internal balance.
SIGN = {"credit_card": -1.0}


def _sign(kind: str) -> float:
    return SIGN.get(kind, 1.0)


def _ordered_transactions(session: Session, account_id: str) -> list[Transaction]:
    rows = session.exec(select(Transaction).where(Transaction.account_id == account_id)).all()
    return sorted(rows, key=lambda t: (t.date, t.id))


def derive_opening_balance(session: Session, account_id: str) -> dict | None:
    """Recompute and store `Account.opening_balance` for one account.

    Returns None when the account has fewer than two transactions carrying a running total
    (nothing to derive from, or nothing to reconcile against), leaving any hand-entered
    opening balance alone. Otherwise returns the derived value plus a reconciliation check
    against the newest running total. The caller commits.
    """
    account = session.get(Account, account_id)
    if account is None:
        return None

    txs = _ordered_transactions(session, account_id)
    with_totals = [t for t in txs if t.running_total is not None]
    if len(with_totals) < 2:
        return None

    sign = _sign(account.kind)
    first, last = with_totals[0], with_totals[-1]

    # Balance before the very first transaction: back out every amount up to and including
    # the earliest row that reports a total.
    cumulative_to_first = 0.0
    for t in txs:
        cumulative_to_first += t.amount
        if t.id == first.id:
            break
    opening_internal = sign * first.running_total - cumulative_to_first

    # Reconciliation: walk forward to the newest reported total and compare.
    cumulative_to_last = 0.0
    for t in txs:
        cumulative_to_last += t.amount
        if t.id == last.id:
            break
    expected_reported = sign * (opening_internal + cumulative_to_last)

    previous = account.opening_balance
    # Store in the per-kind convention meta.openingBalances documents.
    account.opening_balance = round(
        opening_internal if sign > 0 else -opening_internal, 2)
    session.add(account)

    return {
        "accountId": account.id,
        "openingBalance": account.opening_balance,
        "previousOpeningBalance": round(previous, 2),
        "expected": round(expected_reported, 2),
        "reported": round(last.running_total, 2),
        "drift": round(last.running_total - expected_reported, 2),
    }


def derive_opening_balances(session: Session, account_ids: set[str]) -> dict:
    """Recompute several accounts, returning what changed and what failed to reconcile.

    `openingBalances` lists every account whose stored opening balance moved — the user
    needs telling, because a statement's running total overrides a value they typed.
    `reconciliation` lists accounts where walking the transactions forward does not land on
    the newest reported total, which means the imported history has a gap or a duplicate.
    """
    changed: list[dict] = []
    drifted: list[dict] = []
    for account_id in sorted(account_ids):
        result = derive_opening_balance(session, account_id)
        if result is None:
            continue
        if result["openingBalance"] != result["previousOpeningBalance"]:
            changed.append(result)
        if abs(result["drift"]) >= 0.01:
            drifted.append(result)
    session.commit()
    return {"openingBalances": changed, "reconciliation": drifted}
