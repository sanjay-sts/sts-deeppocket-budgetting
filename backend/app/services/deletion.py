"""Shared cascade-delete helper.

`cascade_delete_account` removes an account and every row that hangs off it
(contributions, snapshots, owner/beneficiary join rows) so callers can force a
delete in one action. The caller is responsible for committing the session.
"""
from sqlmodel import Session, select

from ..models import (
    Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution,
    RecurringContribution, Transaction,
)


def cascade_delete_account(session: Session, account_id: str) -> None:
    # Delete child rows first, then the account itself. Caller commits.
    # Property references are annotations, not ownership: a transaction tagged to this
    # property lives on some OTHER account, and a mortgage linked to it is a real
    # account in its own right. Both are unlinked, never deleted.
    for row in session.exec(select(Transaction).where(Transaction.property_id == account_id)).all():
        row.property_id = None
        session.add(row)
    for row in session.exec(select(Account).where(Account.linked_account_id == account_id)).all():
        row.linked_account_id = None
        session.add(row)
    for row in session.exec(select(Contribution).where(Contribution.account_id == account_id)).all():
        session.delete(row)
    # Transactions too: they carry an account_id FK, so leaving them behind stranded every
    # imported row of a deleted chequing account or credit card in the payload.
    for row in session.exec(select(Transaction).where(Transaction.account_id == account_id)).all():
        session.delete(row)
    for row in session.exec(
            select(RecurringContribution).where(RecurringContribution.account_id == account_id)).all():
        session.delete(row)
    for row in session.exec(select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == account_id)).all():
        session.delete(row)
    for row in session.exec(select(AccountOwner).where(AccountOwner.account_id == account_id)).all():
        session.delete(row)
    for row in session.exec(select(AccountBeneficiary).where(AccountBeneficiary.account_id == account_id)).all():
        session.delete(row)
    a = session.get(Account, account_id)
    if a:
        session.delete(a)
