"""Resolving the import's `account` column by name, not just by id.

Real exports name an account the way a human does ("Sanjay TD AeroPlan Card"), never by the
app's internal `acc_…` id, so an exact primary-key lookup skipped every row.
"""
from sqlmodel import Session

from app.models import Account, AccountOwner, Category, Person
from app.services.transactions_csv import import_transactions_csv


def _csv(account_label: str) -> str:
    return (
        "Date,merchant,amount,payment,running_total,account\n"
        f"04/30/2026,COSTCO WHOLESALE,73.92,,413.24,{account_label}\n"
    )


def _setup(session: Session) -> None:
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="acc_abc123", institution="TD", account_type="aeroplan",
                        kind="credit_card", is_liability=True,
                        custom_name="Sanjay TD AeroPlan Card"))
    session.add(AccountOwner(account_id="acc_abc123", person_id="p1"))
    session.commit()


def test_resolves_by_custom_name(session):
    _setup(session)
    summary = import_transactions_csv(_csv("Sanjay TD AeroPlan Card"), session)
    assert summary["created"] == 1 and summary["errors"] == []
    assert summary["unknownAccounts"] == []


def test_resolution_is_case_and_whitespace_insensitive(session):
    _setup(session)
    summary = import_transactions_csv(_csv("  sanjay td aeroplan CARD  "), session)
    assert summary["created"] == 1, summary["errors"]


def test_resolves_by_computed_display_name(session):
    """The name shown in the UI when there is no custom override: owners + institution + type."""
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.add(Account(id="acc_xyz789", institution="TD", account_type="chequing",
                        kind="chequing"))
    session.add(AccountOwner(account_id="acc_xyz789", person_id="p1"))
    session.commit()

    summary = import_transactions_csv(_csv("Sanjay TD chequing"), session)
    assert summary["created"] == 1, summary["errors"]


def test_id_still_resolves(session):
    _setup(session)
    assert import_transactions_csv(_csv("acc_abc123"), session)["created"] == 1


def test_ambiguous_name_is_reported_not_guessed(session):
    _setup(session)
    session.add(Account(id="acc_dup", institution="TD", account_type="other",
                        kind="credit_card", custom_name="Sanjay TD AeroPlan Card"))
    session.commit()

    summary = import_transactions_csv(_csv("Sanjay TD AeroPlan Card"), session)
    assert summary["created"] == 0 and summary["skipped"] == 1
    assert "ambiguous account" in summary["errors"][0]["reason"]
    # Not offerable as "create this account" — it is already two real accounts.
    assert summary["unknownAccounts"] == []


def test_unknown_labels_are_collected_for_the_ui(session):
    _setup(session)
    unknown = (
        "Date,merchant,amount,payment,running_total,account\n"
        "04/30/2026,SHOP,10.00,,1.00,Sanjay TD AeroPlan Card\n"
        "04/29/2026,SHOP,10.00,,2.00,Some Other Card\n"
        "04/28/2026,SHOP,10.00,,3.00,Some Other Card\n"
    )
    summary = import_transactions_csv(unknown, session)
    assert summary["created"] == 1 and summary["skipped"] == 2
    # Deduped, first-seen order, so the UI offers one create button per missing account.
    assert summary["unknownAccounts"] == ["Some Other Card"]
    assert summary["format"] == "credit_card"
    assert "must match an existing account's id or name" in summary["errors"][0]["reason"]
