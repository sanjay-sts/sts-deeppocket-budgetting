from sqlmodel import select
from app.models import Person, Account, InvestmentSnapshot, Contribution
from seed import seed


def test_seed_populates_editable_domain(session):
    seed(session, investments="demo")
    assert len(session.exec(select(Person)).all()) >= 1
    assert len(session.exec(select(Account)).all()) >= 1
    assert len(session.exec(select(InvestmentSnapshot)).all()) >= 1


def test_seed_is_idempotent(session):
    seed(session, investments="demo")
    p1 = len(session.exec(select(Person)).all())
    a1 = len(session.exec(select(Account)).all())
    s1 = len(session.exec(select(InvestmentSnapshot)).all())
    seed(session, investments="demo")
    assert len(session.exec(select(Person)).all()) == p1
    assert len(session.exec(select(Account)).all()) == a1
    assert len(session.exec(select(InvestmentSnapshot)).all()) == s1


def test_seed_investments_empty_keeps_people_drops_investments(session):
    seed(session, investments="empty")
    assert len(session.exec(select(Person)).all()) >= 1
    assert session.exec(select(Account)).all() == []
    assert session.exec(select(InvestmentSnapshot)).all() == []
    assert session.exec(select(Contribution)).all() == []
