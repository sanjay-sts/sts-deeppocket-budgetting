import csv
import io
import re

from sqlmodel import Session, select

from ..constants import csv_cell, new_id, normalize_date, parse_amount
from ..models import Account, AccountOwner, Category, Person, Transaction
from .categorize import categorize
from .opening_balance import derive_opening_balances

# Two real export shapes, sniffed by header set (issue: spec §6).
BANK_HEADERS = {"date", "transaction_detail", "withdrawal", "deposit", "account"}
CC_HEADERS = {"date", "merchant", "amount", "payment", "account"}

# Stand-in when a CSV has no description column at all (some bank exports are just
# date/debit/credit/balance). Dedup compensates — see _persist_row.
NO_DESCRIPTION = "(no description)"

_SLASH_DATE_RE = re.compile(r"(\d{2})/(\d{2})/\d{4}")


def sniff_day_first(dates) -> bool:
    """Decide the slash-date order for a whole file: DD/MM/YYYY or MM/DD/YYYY.

    A bank is consistent within one export, so a single unambiguous date — a first
    component over 12 (real TD chequing exports) or a second component over 12 — settles
    the order for every ambiguous row in the file. A full statement almost always contains
    one. Evidence both ways means the file can't be parsed at all; no evidence keeps the
    documented MM/DD default, where any mistake still surfaces as reconciliation drift.
    """
    day_first = month_first = False
    for s in dates:
        m = _SLASH_DATE_RE.fullmatch(s.strip())
        if not m:
            continue
        if int(m[1]) > 12:
            day_first = True
        if int(m[2]) > 12:
            month_first = True
    if day_first and month_first:
        raise ValueError(
            "Conflicting date orders in this file: some dates only work as DD/MM/YYYY "
            "and others only as MM/DD/YYYY.")
    return day_first


def _clean_merchant(raw: str) -> str:
    # Same cleanup the mock generator applies (mock/generate.py resolve_alias).
    cleaned = raw.split("#")[0].strip().rstrip(",.").title()
    return cleaned or raw


def _parse_amount(row: dict, neg_col: str, pos_col: str) -> float:
    neg, pos = row.get(neg_col, ""), row.get(pos_col, "")
    if bool(neg) == bool(pos):
        raise ValueError(f"exactly one of {neg_col}/{pos_col} must have an amount")
    return -parse_amount(neg) if neg else parse_amount(pos)


def _new_summary(fmt: str) -> dict:
    return {
        "created": 0, "duplicates": 0, "skipped": 0, "errors": [],
        "categorized": {"history": 0, "rules": 0, "unclassified": 0},
        "format": fmt,
        # Labels in the account column that matched no account, deduped in first-seen order,
        # so the UI can offer to create them instead of making the user edit the CSV.
        "unknownAccounts": [],
        "openingBalances": [], "reconciliation": [],
    }


def _transfer_category_ids(session: Session) -> set[str]:
    return {c.id for c in session.exec(select(Category)).all() if c.group == "transfers"}


def _account_index(session: Session) -> dict[str, list[str]]:
    """Map every label an account can be named by -> matching account ids.

    Built once per import, not per row. Labels are lowercased and trimmed: the account id,
    the custom name, and the computed display name (owners + institution + account_type,
    matching services/fixtures._account_out). Values are lists so an ambiguous label can be
    reported as such rather than silently resolving to whichever row came back first.
    """
    people = {p.id: p.name for p in session.exec(select(Person)).all()}
    owners: dict[str, list[str]] = {}
    for row in session.exec(select(AccountOwner)).all():
        owners.setdefault(row.account_id, []).append(row.person_id)

    index: dict[str, list[str]] = {}

    def add(label: str, account_id: str) -> None:
        key = label.strip().lower()
        if not key:
            return
        ids = index.setdefault(key, [])
        if account_id not in ids:
            ids.append(account_id)

    for a in session.exec(select(Account)).all():
        add(a.id, a.id)
        if a.custom_name:
            add(a.custom_name, a.id)
        owner_names = sorted(people.get(pid, pid) for pid in owners.get(a.id, []))
        computed = " ".join(
            x for x in [", ".join(owner_names), a.institution, a.account_type] if x
        ).strip()
        add(computed, a.id)
    return index


def _resolve_account_id(index: dict[str, list[str]], label: str) -> str:
    matches = index.get(label.strip().lower(), [])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(
            f"ambiguous account: {label!r} matches {len(matches)} accounts — use the account id")
    raise ValueError(f"unknown account: {label!r} (must match an existing account's id or name)")


def _note_unknown_account(summary: dict, label: str, reason: str) -> None:
    # Only an unmatched label is offerable as "create this account"; an ambiguous one is
    # already several real accounts and needs the user to pick, not to make another.
    if not reason.startswith("unknown account:"):
        return
    label = label.strip()
    if label and label not in summary["unknownAccounts"]:
        summary["unknownAccounts"].append(label)


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
    conditions = [
        Transaction.account_id == account_id,
        Transaction.date == date,
        Transaction.raw_merchant == raw_merchant,
        Transaction.amount == amount,
    ]
    if raw_merchant == NO_DESCRIPTION and running_total is not None:
        # With no description to tell them apart, two same-day same-amount rows (a pair of
        # identical fees, say) look identical and the second would be dropped as a
        # duplicate. The running total differs per row, so it separates them. Narrow by
        # design: widening the key for every import would break dedup across overlapping
        # statements, whose running totals legitimately differ for the same transaction.
        conditions.append(Transaction.running_total == running_total)
    if session.exec(select(Transaction).where(*conditions)).first():
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


def _finish(session: Session, summary: dict, touched: set[str]) -> dict:
    """Recompute opening balances for every account the import wrote to."""
    if touched:
        summary.update(derive_opening_balances(session, touched))
    return summary


def import_transactions_csv(text: str, session: Session) -> dict:
    reader = csv.DictReader(io.StringIO(text))
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    if BANK_HEADERS.issubset(headers):
        summary = _new_summary("bank")
        merchant_col, neg_col, pos_col = "transaction_detail", "withdrawal", "deposit"
    elif CC_HEADERS.issubset(headers):
        summary = _new_summary("credit_card")
        merchant_col, neg_col, pos_col = "merchant", "amount", "payment"
    else:
        summary = _new_summary("unrecognized")
        summary["errors"].append({
            "row": 0,
            "reason": (
                "Unrecognized CSV. Expected bank columns "
                f"({', '.join(sorted(BANK_HEADERS))}) or credit-card columns "
                f"({', '.join(sorted(CC_HEADERS))}). Use the column-mapping wizard for other formats."
            ),
        })
        return summary

    rows = [{(k or "").strip().lower(): csv_cell(v) for k, v in raw.items()} for raw in reader]
    try:
        day_first = sniff_day_first(r.get("date", "") for r in rows)
    except ValueError as e:
        summary["errors"].append({"row": 0, "reason": str(e)})
        return summary

    transfer_categories = _transfer_category_ids(session)
    accounts = _account_index(session)
    touched: set[str] = set()

    for i, row in enumerate(rows, start=1):
        label = row.get("account", "")
        try:
            date = normalize_date(row["date"], day_first=day_first)
            amount = _parse_amount(row, neg_col, pos_col)
            raw_merchant = row[merchant_col]
            if not raw_merchant:
                raise ValueError(f"missing {merchant_col}")
            account_id = _resolve_account_id(accounts, label)
            running_total = float(row["running_total"]) if row.get("running_total") else None
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            _note_unknown_account(summary, label, str(e))
            continue

        touched.add(account_id)
        _persist_row(
            session, date=date, amount=amount, raw_merchant=raw_merchant,
            account_id=account_id, running_total=running_total,
            transfer_categories=transfer_categories, summary=summary,
        )

    return _finish(session, summary, touched)


# --- headerless support -------------------------------------------------------------------
# Raw exports from at least one major Canadian bank ship with no header row at all, so
# DictReader would silently consume the first transaction as column names. The wizard reads
# these positionally instead; the auto-detect path above still requires known headers.

_AMOUNT_RE = re.compile(r"^-?\$?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\$?\d+(\.\d+)?$")


def positional_headers(count: int) -> list[str]:
    return [f"col{i}" for i in range(1, count + 1)]


def _looks_like_date(cell: str) -> bool:
    s = cell.strip()
    return bool(
        re.fullmatch(r"\d{8}", s)
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}", s)
        or re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", s)
    )


def _looks_like_amount(cell: str) -> bool:
    s = cell.strip()
    return bool(s) and bool(_AMOUNT_RE.match(s))


def looks_headerless(first_row: list[str]) -> bool:
    """True when the first row is data rather than column names.

    A header row is words; a data row leads with a date and carries amounts. Requiring one
    of those two positives (rather than guessing from the absence of known header words)
    keeps unfamiliar-but-real headers — 'date, spent, incoming, running total' — classified
    correctly, since none of those cells parses as a date or an amount.
    """
    if not first_row:
        return False
    if any(_looks_like_date(c) for c in first_row):
        return True
    return sum(1 for c in first_row if _looks_like_amount(c)) >= 2


def preview_transactions_csv(
    text: str, sample_size: int = 5, headerless: bool | None = None,
) -> dict:
    """Parse the header row and a few sample rows so the UI can build a column mapping.

    On a headerless file the columns are named col1..colN and the first row is returned as
    data, not swallowed as names. `headerless` overrides the guess when the user corrects it.
    """
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        return {"headers": [], "sampleRows": [], "rowCount": 0, "headerless": False}

    if headerless is None:
        headerless = looks_headerless(rows[0])
    if headerless:
        width = max(len(r) for r in rows)
        headers = positional_headers(width)
        data = rows
    else:
        headers = [(c or "").strip() for c in rows[0]]
        data = rows[1:]

    sample_rows = [
        {h: csv_cell(r[i] if i < len(r) else "") for i, h in enumerate(headers)}
        for r in data[:sample_size]
    ]
    return {
        "headers": headers,
        "sampleRows": sample_rows,
        "rowCount": len(data),
        "headerless": headerless,
    }


def _validate_mapping(mapping, header_set: set[str]) -> str | None:
    single = bool(mapping.amountColumn)
    split = bool(mapping.debitColumn) or bool(mapping.creditColumn)
    if single and split:
        return "Specify either a single amount column or debit/credit columns, not both."
    if not single and not split:
        return "Specify an amount column, or a debit and/or credit column."
    if bool(mapping.accountColumn) == bool(mapping.accountId):
        return "Specify exactly one of an account column or a fixed account."

    # merchantColumn is optional: some exports have no description column at all.
    needed = [mapping.dateColumn]
    if mapping.merchantColumn:
        needed.append(mapping.merchantColumn)
    if single:
        needed.append(mapping.amountColumn)
    if mapping.debitColumn:
        needed.append(mapping.debitColumn)
    if mapping.creditColumn:
        needed.append(mapping.creditColumn)
    if mapping.accountColumn:
        needed.append(mapping.accountColumn)
    if mapping.runningTotalColumn:
        needed.append(mapping.runningTotalColumn)
    missing = [c for c in needed if c not in header_set]
    if missing:
        return f"Columns not found in CSV: {', '.join(missing)}"
    return None


def _mapped_rows(text: str, headerless: bool) -> tuple[set[str], list[dict]]:
    """Yield (header set, row dicts) for either a headed or a headerless file."""
    rows = [r for r in csv.reader(io.StringIO(text)) if any((c or "").strip() for c in r)]
    if not rows:
        return set(), []
    if headerless:
        headers = positional_headers(max(len(r) for r in rows))
        data = rows
    else:
        headers = [(c or "").strip() for c in rows[0]]
        data = rows[1:]
    dicts = [
        {h: csv_cell(r[i] if i < len(r) else "") for i, h in enumerate(headers)}
        for r in data
    ]
    return set(headers), dicts


def import_transactions_csv_mapped(text: str, mapping, session: Session) -> dict:
    """Import an arbitrary CSV using a user-supplied column mapping (the wizard path)."""
    summary = _new_summary("mapped")
    header_set, rows = _mapped_rows(text, mapping.headerless)

    problem = _validate_mapping(mapping, header_set)
    if problem:
        summary["errors"].append({"row": 0, "reason": problem})
        return summary

    single = bool(mapping.amountColumn)
    transfer_categories = _transfer_category_ids(session)
    accounts = _account_index(session)
    touched: set[str] = set()

    for i, row in enumerate(rows, start=1):
        label = mapping.accountId or row.get(mapping.accountColumn, "")
        try:
            date = normalize_date(row.get(mapping.dateColumn, ""), day_first=mapping.dayFirst)
            raw_merchant = row.get(mapping.merchantColumn, "") if mapping.merchantColumn else ""
            if not raw_merchant:
                if mapping.merchantColumn:
                    raise ValueError(f"missing {mapping.merchantColumn}")
                raw_merchant = NO_DESCRIPTION
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
            running_total = None
            if mapping.runningTotalColumn:
                cell = row.get(mapping.runningTotalColumn, "")
                running_total = parse_amount(cell) if cell else None
            account_id = _resolve_account_id(accounts, label)
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            _note_unknown_account(summary, label, str(e))
            continue

        touched.add(account_id)
        _persist_row(
            session, date=date, amount=amount, raw_merchant=raw_merchant,
            account_id=account_id, running_total=running_total,
            transfer_categories=transfer_categories, summary=summary,
        )

    return _finish(session, summary, touched)
