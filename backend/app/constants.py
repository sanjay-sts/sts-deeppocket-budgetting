import re
import uuid

# kinds served to the frontend (must stay within the AccountKind union)
BANK_KINDS = {"chequing", "savings", "credit_card"}
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
}

CONTRIBUTION_KINDS = {"tfsa", "rrsp", "resp", "fhsa"}


def normalize_kind(account_type: str) -> str:
    return KIND_MAP.get(account_type.strip().lower(), "non_registered")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def normalize_date(s: str) -> str:
    """Accept 'YYYYMMDD' or 'YYYY-MM-DD'; return ISO 'YYYY-MM-DD'. Raise on anything else."""
    s = s.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    raise ValueError(f"Unrecognized date format: {s!r} (expected YYYYMMDD or YYYY-MM-DD)")
