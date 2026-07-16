"""Shared cascade-delete helper.

`cascade_delete_account` removes an account and every row that hangs off it
(contributions, snapshots, owner/beneficiary join rows) so callers can force a
delete in one action. The caller is responsible for committing the session.
"""
from sqlmodel import Session, select

from ..models import Account, AccountOwner, AccountBeneficiary, InvestmentSnapshot, Contribution


def cascade_delete_account(session: Session, account_id: str) -> None:
    # Delete child rows first, then the account itself. Caller commits.
    for row in session.exec(select(Contribution).where(Contribution.account_id == account_id)).all():
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
