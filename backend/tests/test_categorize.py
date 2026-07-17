from sqlmodel import Session

from app.models import Account, Category, Rule, Transaction
from app.services.categorize import categorize


def _setup(session: Session) -> None:
    session.add(Category(id="groceries", name="Groceries", group="essentials"))
    session.add(Category(id="dining", name="Dining", group="lifestyle"))
    session.add(Category(id="unclassified", name="Unclassified", group="lifestyle"))
    session.add(Account(id="chq", institution="TD", account_type="chequing", kind="chequing"))
    session.commit()


def test_history_beats_rules(session):
    _setup(session)
    session.add(Transaction(
        id="old", account_id="chq", date="2026-01-01",
        raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
        amount=-50, category_id="groceries",
    ))
    session.add(Rule(id="r1", keyword="costco", category_id="dining", created_at="2026-01-02T00:00:00"))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("groceries", "history")


def test_history_uses_most_recent(session):
    _setup(session)
    session.add(Transaction(id="a", account_id="chq", date="2026-01-01",
                            raw_merchant="X", merchant="Tims", amount=-5, category_id="groceries"))
    session.add(Transaction(id="b", account_id="chq", date="2026-02-01",
                            raw_merchant="X", merchant="Tims", amount=-5, category_id="dining"))
    session.commit()
    assert categorize(session, "X", "Tims") == ("dining", "history")


def test_rules_match_substring_case_insensitive_newest_first(session):
    _setup(session)
    session.add(Rule(id="r1", keyword="costco", category_id="groceries", created_at="2026-01-01T00:00:00"))
    session.add(Rule(id="r2", keyword="costco whol", category_id="dining", created_at="2026-02-01T00:00:00"))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("dining", "rules")


def test_fallback_unclassified(session):
    _setup(session)
    assert categorize(session, "NEW MERCHANT", "New Merchant") == ("unclassified", "unclassified")


def test_unclassified_history_does_not_shadow_a_matching_rule(session):
    _setup(session)
    session.add(Transaction(
        id="old", account_id="chq", date="2026-01-01",
        raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
        amount=-50, category_id="unclassified",
    ))
    session.add(Rule(id="r1", keyword="costco", category_id="groceries", created_at="2026-01-02T00:00:00"))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("groceries", "rules")


def test_unclassified_history_falls_back_to_unclassified_without_a_rule(session):
    _setup(session)
    session.add(Transaction(
        id="old", account_id="chq", date="2026-01-01",
        raw_merchant="COSTCO WHOLESALE W1283", merchant="Costco Wholesale W1283",
        amount=-50, category_id="unclassified",
    ))
    session.commit()
    assert categorize(session, "COSTCO WHOLESALE W1283", "Costco Wholesale W1283") == ("unclassified", "unclassified")
