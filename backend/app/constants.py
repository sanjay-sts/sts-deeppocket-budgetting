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
}

CONTRIBUTION_KINDS = {"tfsa", "rrsp", "resp", "fhsa"}

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
    """Tolerate thousands separators and a leading currency symbol ('$1,234.56')."""
    return float(s.replace(",", "").replace("$", "").strip())


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
