import math
import re
import uuid

# kinds served to the frontend (must stay within the AccountKind union)
BANK_KINDS = {"chequing", "savings", "credit_card", "cash"}
INVESTMENT_KINDS = {"tfsa", "rrsp", "resp", "fhsa", "dcpp", "non_registered", "crypto"}

# free-text account_type -> a legal AccountKind. Unknown types fall back to non_registered.
KIND_MAP = {
    "tfsa": "tfsa",
    "rrsp": "rrsp",
    "resp": "resp",
    "fhsa": "fhsa",
    "crypto": "crypto",
    "dcpp": "dcpp",
    "dccp2": "dcpp",
    "dcpp2": "dcpp",
    "rpp": "dcpp",
    "non_registered": "non_registered",
    "nonregistered": "non_registered",
    "margin": "non_registered",
    "cash": "non_registered",
    # Banking kinds. Without these, normalize_kind("credit_card") fell through to
    # non_registered, which drops the account out of BANK_KINDS — and so out of
    # meta.openingBalances and every cash/credit KPI. Note "cash" above deliberately
    # stays mapped to non_registered: for the investment importer, account_type "cash"
    # means a cash/margin investment account, not a cash wallet.
    "chequing": "chequing",
    "checking": "chequing",
    "savings": "savings",
    "credit_card": "credit_card",
    "creditcard": "credit_card",
}

CONTRIBUTION_KINDS = {"tfsa", "rrsp", "resp", "fhsa"}

# Stated (carry-forward) room is personal; RESP pacing is per-beneficiary, so no 'resp'.
STATED_ROOM_KINDS = {"tfsa", "rrsp", "fhsa"}

# semi_monthly = the 1st and 15th of each month.
RECURRING_FREQUENCIES = {"weekly", "biweekly", "semi_monthly", "monthly"}

# Starting category set for a brand-new database (issue #17), so an empty DB is never
# category-less. A starting point, NOT a fixed taxonomy — users rename/add/delete freely,
# and the bootstrap only ever runs against a completely empty categories table.
# Kept in step with mock/generate.py's CATEGORIES (tests/test_default_categories.py
# fails on drift), because seed.py loads categories from the generated fixture.
DEFAULT_CATEGORIES: list[dict] = [
    # essentials — the non-discretionary core
    {"id": "housing", "name": "Housing", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "utilities", "name": "Utilities", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "groceries", "name": "Groceries", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "transportation", "name": "Transportation", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "insurance", "name": "Insurance", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "healthcare", "name": "Healthcare", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "childcare", "name": "Childcare", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "phone_internet", "name": "Phone & Internet", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    {"id": "home_maintenance", "name": "Home Maintenance", "group": "essentials", "bucket503020": "needs", "is_essential": True},
    # lifestyle — discretionary
    {"id": "dining", "name": "Dining", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "entertainment", "name": "Entertainment", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "subscriptions", "name": "Subscriptions", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "shopping", "name": "Shopping", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "personal_care", "name": "Personal Care", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "gym", "name": "Gym & Fitness", "group": "lifestyle", "bucket503020": "wants"},
    {"id": "travel", "name": "Travel", "group": "lifestyle", "bucket503020": "wants"},
    # family
    {"id": "kids", "name": "Kids", "group": "family", "bucket503020": "needs"},
    {"id": "education", "name": "Education", "group": "family", "bucket503020": "needs"},
    {"id": "gifts", "name": "Gifts & Donations", "group": "family", "bucket503020": "wants"},
    # financial
    {"id": "investments_out", "name": "Investments", "group": "financial", "bucket503020": "savings"},
    {"id": "bank_fees", "name": "Bank Fees", "group": "financial", "bucket503020": "needs"},
    {"id": "taxes", "name": "Taxes", "group": "financial", "bucket503020": "needs"},
    # transfers — excluded from spend by the transfer flag
    {"id": "transfer", "name": "Transfer", "group": "transfers"},
    {"id": "cc_payment", "name": "Credit Card Payment", "group": "transfers"},
    # income
    {"id": "salary", "name": "Salary", "group": "income"},
    {"id": "interest", "name": "Interest", "group": "income"},
    {"id": "dividends", "name": "Dividends", "group": "income"},
    {"id": "tax_refund", "name": "Tax Refund", "group": "income"},
    {"id": "ccb", "name": "Canada Child Benefit", "group": "income"},
    {"id": "misc_income", "name": "Misc Income", "group": "income"},
    # fallback for anything auto-categorization can't place
    {"id": "unclassified", "name": "Unclassified", "group": "lifestyle"},
]

# CRA limits are law, not user data — served into /api/data's craLimits block.
# Values match lib/canadian.ts CRA_LIMITS_2025 on the frontend.
CRA_LIMITS_2025 = {
    "TFSA_ANNUAL": 7000,
    "RRSP_ANNUAL_PCT": 0.18,
    "RRSP_ANNUAL_CAP": 32490,
    "RESP_LIFETIME_PER_CHILD": 50000,
    "RESP_ANNUAL_FOR_FULL_CESG": 2500,
    "FHSA_ANNUAL": 8000,
    "FHSA_LIFETIME": 40000,
    "CESG_RATE": 0.2,
    "CESG_ANNUAL_PER_CHILD": 500,
    "CESG_LIFETIME_PER_CHILD": 7200,
}


def normalize_kind(account_type: str) -> str:
    return KIND_MAP.get(account_type.strip().lower(), "non_registered")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def parse_amount(s: str) -> float:
    """Tolerate thousands separators and a leading currency symbol ('$1,234.56').

    Rejects non-finite values: float() happily accepts 'nan'/'inf' (and 1e400 overflows to
    inf), which SQLite would store as NULL and every KPI sum would then turn into NaN.
    """
    value = float(s.replace(",", "").replace("$", "").strip())
    if not math.isfinite(value):
        raise ValueError(f"not a finite amount: {s!r}")
    return value


def csv_cell(value) -> str:
    """Flatten one DictReader cell to text.

    DictReader yields a LIST for the cells past the end of the header (a ragged row, e.g. an
    unquoted comma in a merchant name) and None for missing ones, so a bare `(v or "").strip()`
    raises AttributeError on the list and 500s the whole import.
    """
    if isinstance(value, list):
        return " ".join(v for v in value if v).strip()
    return (value or "").strip()


def normalize_date(s: str) -> str:
    """Accept 'YYYYMMDD', 'YYYY-MM-DD', or 'MM/DD/YYYY' (bank exports); return ISO."""
    s = s.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        return f"{s[6:10]}-{s[0:2]}-{s[3:5]}"
    raise ValueError(f"Unrecognized date format: {s!r} (expected YYYYMMDD, YYYY-MM-DD, or MM/DD/YYYY)")
