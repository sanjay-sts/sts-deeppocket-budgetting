"""Seeding the demo real-estate data (M5).

seed.py used to seed accounts through two kind-filtered branches (investment, bank), so
property/mortgage fixture accounts would be silently dropped — while their snapshots
seeded anyway, orphaned. These tests pin the third branch, the property tags on
transactions, and the wipe paths (seed --investments=empty and the admin purge), which
must treat property/mortgage as part of the valuation domain they clear.
"""
from sqlmodel import Session, select

from app.models import Account, Category, InvestmentSnapshot, Transaction
from seed import seed


def test_seed_creates_property_and_mortgage_accounts(session: Session):
    seed(session)
    residence = session.get(Account, "prop_residence")
    assert residence is not None
    assert residence.kind == "property"
    assert residence.custom_name  # display name preserved from the fixture
    assert residence.purchase_price and residence.purchase_price > 0
    assert residence.purchase_date
    assert not residence.is_rental

    mortgage = session.get(Account, "mort_residence")
    assert mortgage is not None
    assert mortgage.kind == "mortgage"
    assert mortgage.is_liability is True
    assert mortgage.linked_account_id == "prop_residence"

    rental = session.get(Account, "prop_rental")
    assert rental is not None and rental.is_rental is True
    assert session.get(Account, "mort_rental").linked_account_id == "prop_rental"


def test_seed_property_snapshots_and_tagged_transactions(session: Session):
    seed(session)
    prop_snaps = session.exec(
        select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == "prop_residence")).all()
    mort_snaps = session.exec(
        select(InvestmentSnapshot).where(InvestmentSnapshot.account_id == "mort_residence")).all()
    assert len(prop_snaps) == 12  # one per generated month
    assert len(mort_snaps) == 12
    # The mortgage principal declines month over month.
    ordered = sorted(mort_snaps, key=lambda s: s.date)
    assert ordered[-1].amount < ordered[0].amount

    # The residence's mortgage payment and the rental's rent are tagged.
    tagged_home = session.exec(select(Transaction).where(
        Transaction.property_id == "prop_residence")).all()
    assert any(t.raw_merchant == "MAPLE TRUST MORTGAGE" for t in tagged_home)
    tagged_rental = session.exec(select(Transaction).where(
        Transaction.property_id == "prop_rental")).all()
    rent = [t for t in tagged_rental if t.amount > 0]
    assert len(rent) == 12  # monthly rent deposits
    assert all(t.category_id == "rental_income" for t in rent)
    assert any(t.amount < 0 for t in tagged_rental)  # rental costs are tagged too


def test_rental_income_is_a_seeded_category(session: Session):
    seed(session)
    cat = session.get(Category, "rental_income")
    assert cat is not None
    assert cat.group == "income"


def test_investments_empty_also_leaves_no_property_accounts(session: Session):
    seed(session, investments="empty")
    kinds = {a.kind for a in session.exec(select(Account)).all()}
    assert "property" not in kinds
    assert "mortgage" not in kinds
    assert session.exec(select(InvestmentSnapshot)).all() == []


def test_admin_purge_investments_takes_property_accounts_too(client, session: Session):
    seed(session)
    r = client.post("/api/admin/purge", json={"mode": "investments"})
    assert r.status_code == 200
    session.expire_all()
    kinds = {a.kind for a in session.exec(select(Account)).all()}
    # A purge wipes the whole valuation domain — otherwise property accounts would
    # survive with their value history deleted, showing as worthless assets.
    assert "property" not in kinds
    assert "mortgage" not in kinds
    # The purge kept banking transactions, so their tags must not dangle at ghosts.
    assert session.exec(select(Transaction).where(
        Transaction.property_id.is_not(None))).all() == []  # type: ignore[union-attr]
