"""First-run bootstrap so an empty database is usable immediately (issue #17)."""
from sqlmodel import Session, select

from ..constants import DEFAULT_CATEGORIES
from ..models import Category


def bootstrap_default_categories(session: Session) -> int:
    """Insert the default categories, but ONLY into a completely empty categories table.

    Returns the number created. Emptiness is the guard on purpose: categories are
    user-owned data, so once even one row exists (seeded, imported, or hand-made) this
    must stay out of the way — otherwise a category the user deliberately deleted would
    reappear on the next restart.
    """
    if session.exec(select(Category)).first() is not None:
        return 0
    for c in DEFAULT_CATEGORIES:
        session.add(Category(
            id=c["id"], name=c["name"], group=c["group"],
            bucket503020=c.get("bucket503020"),
            is_essential=c.get("is_essential", False),
        ))
    session.commit()
    return len(DEFAULT_CATEGORIES)
