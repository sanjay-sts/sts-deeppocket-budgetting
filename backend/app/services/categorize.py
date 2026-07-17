from sqlmodel import Session, select

from ..models import Rule, Transaction

UNCLASSIFIED = "unclassified"


def categorize(session: Session, raw_merchant: str, merchant: str) -> tuple[str, str]:
    """Pick a category for an incoming transaction: exact merchant history first
    (most recent by date wins), then keyword rules (newest rule first, case-insensitive
    substring against raw + cleaned merchant), else the 'unclassified' category.
    Returns (category_id, method) so import summaries can report the split."""
    hit = session.exec(
        select(Transaction)
        .where(Transaction.merchant == merchant)
        .order_by(Transaction.date.desc())  # type: ignore[attr-defined]
    ).first()
    if hit:
        return hit.category_id, "history"

    hay = f"{raw_merchant} {merchant}".lower()
    rules = session.exec(select(Rule)).all()
    for rule in sorted(rules, key=lambda r: r.created_at, reverse=True):
        if rule.keyword.lower() in hay:
            return rule.category_id, "rules"

    return UNCLASSIFIED, "unclassified"
