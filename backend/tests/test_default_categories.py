"""A brand-new database must not be category-less (issue #17).

The defaults are a starting point, not a fixed taxonomy: users rename/add/delete freely
afterward, so the bootstrap must never re-add what someone deliberately deleted.
"""
import json

from sqlmodel import select

from app.config import FIXTURES_PATH
from app.constants import DEFAULT_CATEGORIES
from app.models import Category
from app.routers.categories import VALID_BUCKETS, VALID_GROUPS
from app.services.bootstrap import bootstrap_default_categories


def test_empty_db_gets_the_default_categories(session):
    assert session.exec(select(Category)).all() == []
    created = bootstrap_default_categories(session)
    assert created == len(DEFAULT_CATEGORIES)
    rows = session.exec(select(Category)).all()
    assert {c.id for c in rows} == {c["id"] for c in DEFAULT_CATEGORIES}
    # the fallback bucket every uncategorized transaction lands in must exist
    assert session.get(Category, "unclassified") is not None


def test_bootstrap_is_idempotent(session):
    bootstrap_default_categories(session)
    before = {c.id: (c.name, c.group) for c in session.exec(select(Category)).all()}
    assert bootstrap_default_categories(session) == 0
    after = {c.id: (c.name, c.group) for c in session.exec(select(Category)).all()}
    assert after == before


def test_bootstrap_never_touches_a_populated_db(session):
    session.add(Category(id="my_own", name="My Own", group="lifestyle"))
    session.commit()
    assert bootstrap_default_categories(session) == 0
    rows = session.exec(select(Category)).all()
    assert [c.id for c in rows] == ["my_own"]


def test_bootstrap_does_not_resurrect_a_deleted_default(session):
    bootstrap_default_categories(session)
    session.delete(session.get(Category, "travel"))
    session.commit()
    assert bootstrap_default_categories(session) == 0
    assert session.get(Category, "travel") is None


def test_defaults_are_internally_valid():
    ids = [c["id"] for c in DEFAULT_CATEGORIES]
    assert len(ids) == len(set(ids)), "duplicate category ids"
    names = [c["name"].lower() for c in DEFAULT_CATEGORIES]
    assert len(names) == len(set(names)), "duplicate category names (the API rejects clashes)"
    for c in DEFAULT_CATEGORIES:
        assert c["group"] in VALID_GROUPS, c
        if c.get("bucket503020") is not None:
            assert c["bucket503020"] in VALID_BUCKETS, c
        assert c["id"] == c["id"].lower().replace(" ", "_")


def test_defaults_cover_a_canadian_family_budget():
    """Issue #17's shopping list — the point of the feature, not incidental detail."""
    by_id = {c["id"]: c for c in DEFAULT_CATEGORIES}
    for required in (
        "groceries", "dining", "transportation", "housing", "utilities", "insurance",
        "healthcare", "childcare", "kids", "subscriptions", "entertainment", "travel",
        "gifts", "personal_care", "home_maintenance", "bank_fees", "salary",
        "transfer", "unclassified",
    ):
        assert required in by_id, f"missing default category: {required}"
    assert any(c["group"] == "income" for c in DEFAULT_CATEGORIES)
    assert any(c["group"] == "transfers" for c in DEFAULT_CATEGORIES)


def test_defaults_match_the_seed_fixture():
    """seed.py loads categories from the fixture; drift between the two would mean a
    seeded DB and a bootstrapped DB disagree about what the defaults are."""
    fixture = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))["categories"]
    fixture_ids = {c["id"] for c in fixture}
    default_ids = {c["id"] for c in DEFAULT_CATEGORIES}
    assert fixture_ids == default_ids, (
        f"only in fixture: {sorted(fixture_ids - default_ids)}; "
        f"only in defaults: {sorted(default_ids - fixture_ids)}"
    )
    by_id = {c["id"]: c for c in fixture}
    for d in DEFAULT_CATEGORIES:
        f = by_id[d["id"]]
        assert f["name"] == d["name"], d["id"]
        assert f["group"] == d["group"], d["id"]
