import csv
import io

from sqlmodel import Session, select

from ..constants import new_id, normalize_date
from ..models import Account, Category, Transaction
from .categorize import categorize

# Two real export shapes, sniffed by header set (issue: spec §6).
BANK_HEADERS = {"date", "transaction_detail", "withdrawal", "deposit", "account"}
CC_HEADERS = {"date", "merchant", "amount", "payment", "account"}


def _clean_merchant(raw: str) -> str:
    # Same cleanup the mock generator applies (mock/generate.py resolve_alias).
    cleaned = raw.split("#")[0].strip().rstrip(",.").title()
    return cleaned or raw


def _parse_amount(row: dict, neg_col: str, pos_col: str) -> float:
    neg, pos = row.get(neg_col, ""), row.get(pos_col, "")
    if bool(neg) == bool(pos):
        raise ValueError(f"exactly one of {neg_col}/{pos_col} must have an amount")
    return -float(neg) if neg else float(pos)


def import_transactions_csv(text: str, session: Session) -> dict:
    summary = {
        "created": 0, "duplicates": 0, "skipped": 0, "errors": [],
        "categorized": {"history": 0, "rules": 0, "unclassified": 0},
    }
    reader = csv.DictReader(io.StringIO(text))
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    if BANK_HEADERS.issubset(headers):
        merchant_col, neg_col, pos_col = "transaction_detail", "withdrawal", "deposit"
    elif CC_HEADERS.issubset(headers):
        merchant_col, neg_col, pos_col = "merchant", "amount", "payment"
    else:
        summary["errors"].append({
            "row": 0,
            "reason": (
                "Unrecognized CSV. Expected bank columns "
                f"({', '.join(sorted(BANK_HEADERS))}) or credit-card columns "
                f"({', '.join(sorted(CC_HEADERS))})."
            ),
        })
        return summary

    transfer_categories = {
        c.id for c in session.exec(select(Category)).all() if c.group == "transfers"
    }

    for i, raw in enumerate(reader, start=1):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            date = normalize_date(row["date"])
            amount = _parse_amount(row, neg_col, pos_col)
            raw_merchant = row[merchant_col]
            if not raw_merchant:
                raise ValueError(f"missing {merchant_col}")
            account_id = row["account"]
            if not session.get(Account, account_id):
                raise ValueError(f"unknown account: {account_id!r} (must match an existing account id)")
            running_total = float(row["running_total"]) if row.get("running_total") else None
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            continue

        existing = session.exec(select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.date == date,
            Transaction.raw_merchant == raw_merchant,
            Transaction.amount == amount,
        )).first()
        if existing:
            summary["duplicates"] += 1
            continue

        merchant = _clean_merchant(raw_merchant)
        category_id, method = categorize(session, raw_merchant, merchant)
        session.add(Transaction(
            id=new_id("tx"), account_id=account_id, date=date,
            raw_merchant=raw_merchant, merchant=merchant, amount=amount,
            category_id=category_id,
            is_transfer=category_id in transfer_categories,
            running_total=running_total,
        ))
        session.commit()
        summary["created"] += 1
        summary["categorized"][method] += 1

    return summary
