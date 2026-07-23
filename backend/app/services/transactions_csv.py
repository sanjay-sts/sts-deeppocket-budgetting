import csv
import io

from sqlmodel import Session, select

from ..constants import new_id, normalize_date, parse_amount
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


def _new_summary() -> dict:
    return {
        "created": 0, "duplicates": 0, "skipped": 0, "errors": [],
        "categorized": {"history": 0, "rules": 0, "unclassified": 0},
    }


def _transfer_category_ids(session: Session) -> set[str]:
    return {c.id for c in session.exec(select(Category)).all() if c.group == "transfers"}


def _persist_row(
    session: Session,
    *,
    date: str,
    amount: float,
    raw_merchant: str,
    account_id: str,
    running_total: float | None,
    transfer_categories: set[str],
    summary: dict,
) -> None:
    """Dedup, categorize, and insert one already-validated row. Shared by both importers."""
    existing = session.exec(select(Transaction).where(
        Transaction.account_id == account_id,
        Transaction.date == date,
        Transaction.raw_merchant == raw_merchant,
        Transaction.amount == amount,
    )).first()
    if existing:
        summary["duplicates"] += 1
        return

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


def import_transactions_csv(text: str, session: Session) -> dict:
    summary = _new_summary()
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
                f"({', '.join(sorted(CC_HEADERS))}). Use the column-mapping wizard for other formats."
            ),
        })
        return summary

    transfer_categories = _transfer_category_ids(session)

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

        _persist_row(
            session, date=date, amount=amount, raw_merchant=raw_merchant,
            account_id=account_id, running_total=running_total,
            transfer_categories=transfer_categories, summary=summary,
        )

    return summary


def preview_transactions_csv(text: str, sample_size: int = 5) -> dict:
    """Parse just the header row and a few sample rows so the UI can build a column mapping."""
    reader = csv.DictReader(io.StringIO(text))
    headers = [(h or "").strip() for h in (reader.fieldnames or [])]
    sample_rows: list[dict] = []
    count = 0
    for raw in reader:
        count += 1
        if len(sample_rows) < sample_size:
            sample_rows.append({(k or "").strip(): (v or "").strip() for k, v in raw.items()})
    return {"headers": headers, "sampleRows": sample_rows, "rowCount": count}


def _validate_mapping(mapping, header_set: set[str]) -> str | None:
    single = bool(mapping.amountColumn)
    split = bool(mapping.debitColumn) or bool(mapping.creditColumn)
    if single and split:
        return "Specify either a single amount column or debit/credit columns, not both."
    if not single and not split:
        return "Specify an amount column, or a debit and/or credit column."
    if bool(mapping.accountColumn) == bool(mapping.accountId):
        return "Specify exactly one of an account column or a fixed account."

    needed = [mapping.dateColumn, mapping.merchantColumn]
    if single:
        needed.append(mapping.amountColumn)
    if mapping.debitColumn:
        needed.append(mapping.debitColumn)
    if mapping.creditColumn:
        needed.append(mapping.creditColumn)
    if mapping.accountColumn:
        needed.append(mapping.accountColumn)
    missing = [c for c in needed if c not in header_set]
    if missing:
        return f"Columns not found in CSV: {', '.join(missing)}"
    return None


def _parse_mapped_date(s: str, day_first: bool) -> str:
    s = s.strip()
    if day_first:
        import re
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):  # DD/MM/YYYY
            return f"{s[6:10]}-{s[3:5]}-{s[0:2]}"
    return normalize_date(s)  # handles YYYYMMDD, YYYY-MM-DD, MM/DD/YYYY


def import_transactions_csv_mapped(text: str, mapping, session: Session) -> dict:
    """Import an arbitrary CSV using a user-supplied column mapping (the wizard path)."""
    summary = _new_summary()
    reader = csv.DictReader(io.StringIO(text))
    header_set = {(h or "").strip() for h in (reader.fieldnames or [])}

    problem = _validate_mapping(mapping, header_set)
    if problem:
        summary["errors"].append({"row": 0, "reason": problem})
        return summary

    single = bool(mapping.amountColumn)
    transfer_categories = _transfer_category_ids(session)

    for i, raw in enumerate(reader, start=1):
        row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
        try:
            date = _parse_mapped_date(row.get(mapping.dateColumn, ""), mapping.dayFirst)
            raw_merchant = row.get(mapping.merchantColumn, "")
            if not raw_merchant:
                raise ValueError(f"missing {mapping.merchantColumn}")
            if single:
                val = row.get(mapping.amountColumn, "")
                if val == "":
                    raise ValueError(f"missing {mapping.amountColumn}")
                amount = parse_amount(val)
                if mapping.amountInvert:
                    amount = -amount
            else:
                debit = row.get(mapping.debitColumn, "") if mapping.debitColumn else ""
                credit = row.get(mapping.creditColumn, "") if mapping.creditColumn else ""
                if bool(debit) == bool(credit):
                    raise ValueError("exactly one of the debit/credit columns must have a value")
                amount = -parse_amount(debit) if debit else parse_amount(credit)
            account_id = mapping.accountId if mapping.accountId else row.get(mapping.accountColumn, "")
            if not session.get(Account, account_id):
                raise ValueError(f"unknown account: {account_id!r} (must match an existing account id)")
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            continue

        _persist_row(
            session, date=date, amount=amount, raw_merchant=raw_merchant,
            account_id=account_id, running_total=None,
            transfer_categories=transfer_categories, summary=summary,
        )

    return summary
