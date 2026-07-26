"""Mock data generator for the DeepPocket budgeting app.

Produces 12 months of deterministic Canadian-family financial data:

  mock/out/bank_transactions.csv   chequing/savings export schema
  mock/out/credit_card.csv         credit-card-bill export schema
  mock/out/investments.csv         monthly snapshot schema
  mock/out/fixtures.json           normalized feed the React frontend reads

The frontend reads fixtures.json directly via src/data/api.ts. The three CSVs
are also produced because they document the schema contract the future
FastAPI importer (Milestone 2) will consume.

Run from the repo root:

    python mock/generate.py --seed 42

No third-party dependencies — stdlib only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Canadian constants
# ---------------------------------------------------------------------------

# Pinned so a bare `python mock/generate.py` reproduces the committed fixture instead of
# sliding the window to the real today. Pass --today to move it deliberately.
DEFAULT_TODAY = "2026-04-14"

CRA_LIMITS_2025: dict[str, float] = {
    "TFSA_ANNUAL": 7000,
    "RRSP_ANNUAL_PCT": 0.18,
    "RRSP_ANNUAL_CAP": 32490,
    "RESP_LIFETIME_PER_CHILD": 50000,
    "RESP_ANNUAL_FOR_FULL_CESG": 2500,
    "FHSA_ANNUAL": 8000,
    "FHSA_LIFETIME": 40000,
    "CESG_RATE": 0.20,
    "CESG_ANNUAL_PER_CHILD": 500,
    "CESG_LIFETIME_PER_CHILD": 7200,
}

# ---------------------------------------------------------------------------
# Household, accounts, categories
# ---------------------------------------------------------------------------

PEOPLE: list[dict[str, Any]] = [
    {"id": "p_adult1", "name": "Avery", "role": "adult", "birthYear": 1986, "grossIncome": 132000},
    {"id": "p_adult2", "name": "Jordan", "role": "adult", "birthYear": 1988, "grossIncome": 76000},
    {"id": "p_child1", "name": "Milo", "role": "child", "birthYear": 2017},
    {"id": "p_child2", "name": "Nova", "role": "child", "birthYear": 2020},
]

ACCOUNTS: list[dict[str, Any]] = [
    # cash
    {"id": "chequing_1", "name": "Maple Trust Chequing (Avery)", "kind": "chequing", "institution": "Maple Trust",      "ownerIds": ["p_adult1"]},
    {"id": "savings_1",  "name": "Maple Trust Savings (Avery)",  "kind": "savings",  "institution": "Maple Trust",      "ownerIds": ["p_adult1"]},
    {"id": "chequing_2", "name": "Maple Trust Chequing (Jordan)", "kind": "chequing", "institution": "Maple Trust",      "ownerIds": ["p_adult2"]},
    {"id": "savings_joint",   "name": "Harbour Joint Savings",     "kind": "savings",  "institution": "Harbour", "ownerIds": ["p_adult1", "p_adult2"]},
    # credit cards
    {"id": "cc_visa_1",     "name": "Maple Trust Visa (Avery)",     "kind": "credit_card", "institution": "Maple Trust",   "ownerIds": ["p_adult1"], "isLiability": True},
    {"id": "cc_rewards_1", "name": "Summit Rewards (Avery)", "kind": "credit_card", "institution": "Summit", "ownerIds": ["p_adult1"], "isLiability": True},
    {"id": "cc_travel_2",   "name": "Northline Travel (Jordan)",   "kind": "credit_card", "institution": "Northline",  "ownerIds": ["p_adult2"], "isLiability": True},
    # investments
    {"id": "tfsa_1",   "name": "BlueLeaf TFSA (Avery)",  "kind": "tfsa",   "institution": "blueleaf", "ownerIds": ["p_adult1"]},
    {"id": "crypto_1", "name": "BlueLeaf Crypto (Avery)","kind": "crypto", "institution": "blueleaf", "ownerIds": ["p_adult1"]},
    {"id": "tfsa_2",   "name": "NorthPeak TFSA (Avery)",     "kind": "tfsa",   "institution": "northpeak",    "ownerIds": ["p_adult1"]},
    {"id": "rrsp_1",   "name": "NorthPeak RRSP (Avery)",     "kind": "rrsp",   "institution": "northpeak",    "ownerIds": ["p_adult1"]},
    {"id": "resp_1",     "name": "NorthPeak RESP (Milo)",      "kind": "resp",   "institution": "northpeak",    "ownerIds": ["p_adult1", "p_adult2"], "beneficiaryId": "p_child1"},
    {"id": "resp_2",     "name": "NorthPeak RESP (Nova)",       "kind": "resp",   "institution": "northpeak",    "ownerIds": ["p_adult1", "p_adult2"], "beneficiaryId": "p_child2"},
    {"id": "tfsa_3",   "name": "MapleTrade TFSA (Avery)",  "kind": "tfsa",   "institution": "mapletrade",  "ownerIds": ["p_adult1"]},
    {"id": "dcpp_1",   "name": "CedarLife DCPP (Avery)",       "kind": "dcpp",   "institution": "cedarlife",      "ownerIds": ["p_adult1"]},
    {"id": "tfsa_4",   "name": "MapleTrade TFSA (Jordan)",  "kind": "tfsa",   "institution": "mapletrade",  "ownerIds": ["p_adult2"]},
    {"id": "rrsp_2",   "name": "MapleTrade RRSP (Jordan)",  "kind": "rrsp",   "institution": "mapletrade",  "ownerIds": ["p_adult2"]},
    {"id": "fhsa_1",   "name": "BlueLeaf FHSA (Avery)",  "kind": "fhsa",   "institution": "blueleaf", "ownerIds": ["p_adult1"]},
    {"id": "fhsa_2",   "name": "BlueLeaf FHSA (Jordan)",  "kind": "fhsa",   "institution": "blueleaf", "ownerIds": ["p_adult2"]},
]

CATEGORIES: list[dict[str, Any]] = [
    # essentials
    {"id": "housing",         "name": "Housing",         "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "utilities",       "name": "Utilities",       "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "groceries",       "name": "Groceries",       "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "transportation",  "name": "Transportation",  "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "insurance",       "name": "Insurance",       "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "healthcare",      "name": "Healthcare",      "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "childcare",       "name": "Childcare",       "group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "phone_internet",  "name": "Phone & Internet","group": "essentials", "bucket503020": "needs", "isEssential": True},
    {"id": "home_maintenance","name": "Home Maintenance","group": "essentials", "bucket503020": "needs", "isEssential": True},
    # lifestyle
    {"id": "dining",          "name": "Dining",          "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "entertainment",   "name": "Entertainment",   "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "subscriptions",   "name": "Subscriptions",   "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "shopping",        "name": "Shopping",        "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "personal_care",   "name": "Personal Care",   "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "gym",             "name": "Gym & Fitness",   "group": "lifestyle",  "bucket503020": "wants"},
    {"id": "travel",          "name": "Travel",          "group": "lifestyle",  "bucket503020": "wants"},
    # family
    {"id": "kids",            "name": "Kids",            "group": "family",     "bucket503020": "needs"},
    {"id": "education",       "name": "Education",       "group": "family",     "bucket503020": "needs"},
    {"id": "gifts",           "name": "Gifts & Donations", "group": "family",   "bucket503020": "wants"},
    # financial
    {"id": "investments_out", "name": "Investments",     "group": "financial",  "bucket503020": "savings"},
    {"id": "bank_fees",       "name": "Bank Fees",       "group": "financial",  "bucket503020": "needs"},
    {"id": "taxes",           "name": "Taxes",           "group": "financial",  "bucket503020": "needs"},
    # transfers
    {"id": "transfer",        "name": "Transfer",        "group": "transfers"},
    {"id": "cc_payment",      "name": "Credit Card Payment","group": "transfers"},
    # income
    {"id": "salary",          "name": "Salary",          "group": "income"},
    {"id": "interest",        "name": "Interest",        "group": "income"},
    {"id": "dividends",       "name": "Dividends",       "group": "income"},
    {"id": "tax_refund",      "name": "Tax Refund",      "group": "income"},
    {"id": "ccb",             "name": "Canada Child Benefit","group": "income"},
    {"id": "misc_income",     "name": "Misc Income",     "group": "income"},
    # fallback
    {"id": "unclassified",    "name": "Unclassified",    "group": "lifestyle"},
]

# Raw merchant strings as they would appear on a real statement
MERCHANTS: dict[str, list[str]] = {
    "groceries": [
        "LOBLAWS #8802", "NO FRILLS #2210", "COSTCO WHOLESALE W4471",
        "REAL CDN SUPERSTORE", "WAL-MART SUPERCENTER#3190", "FARM BOY #12",
        "T&T SUPERMARKET",
    ],
    "dining": [
        "TIM HORTONS #0918", "STARBUCKS #00214", "A&W #2078",
        "MCDONALD'S #20551", "BOSTON PIZZA", "PIZZA HUT",
        "CAFETERIA-NORTHWIND-40188",
    ],
    "transportation": [
        "PETRO-CANADA #00744", "ESSO RM 1030", "SHELL C01188",
        "PRESTO FARES", "UBER CANADA", "PARKING METER 4310",
    ],
    "subscriptions": [
        "NETFLIX.COM", "DISNEY PLUS", "CRAVE", "SPOTIFY R4T7QWZ2",
        "AMZN PRIME CA*KT4", "APPLE.COM/BILL ICLOUD",
    ],
    "shopping": [
        "AMZN Mktp CA*QW7ZP2M91", "AMAZON.CA*LM3QP",
        "CANADIAN TIRE #0177", "HOME DEPOT #4409", "HUDSON'S BAY",
        "INDIGO BOOKS #884", "WAYFAIR.CA",
    ],
    "kids": [
        "INDIGO KIDS", "MASTERMIND TOYS", "WALMART KIDS",
    ],
    "entertainment": [
        "CINEPLEX ODEON", "RECREATION CENTRE",
    ],
    "personal_care": [
        "GREAT CLIPS #118", "SEPHORA #209",
    ],
    "healthcare": [
        "SHOPPERS DRUG MART #3307", "REXALL #2270", "MAPLE LANE DENTISTRY",
    ],
    "travel": [
        "AIR CANADA", "WESTJET", "AIRBNB CA*RV2",
    ],
    "gifts": [
        "AMAZON.CA GIFTS", "INDIGO GIFTS",
    ],
}

# Alias table — collapses messy raw strings to a canonical merchant name.
# Anything not listed falls through to a title-cased version of the raw string.
ALIASES: dict[str, str] = {
    "AMZN Mktp CA*QW7ZP2M91": "Amazon.ca",
    "AMAZON.CA*LM3QP": "Amazon.ca",
    "AMZN PRIME CA*KT4": "Amazon Prime",
    "AMAZON.CA GIFTS": "Amazon.ca",
    "CAFETERIA-NORTHWIND-40188": "Northwind Cafeteria",
    "SPOTIFY R4T7QWZ2": "Spotify",
    "APPLE.COM/BILL ICLOUD": "iCloud",
    "GOODLIFE CLUBS  #2214": "GoodLife Fitness",
    "MAPLE TRUST INS/ASSUR INS": "Maple Trust Insurance",
    "Sunnybrook Daycare  FEE": "Sunnybrook Daycare",
    "Little Pines Day  FEE": "Little Pines Daycare",
    "MAPLE TRUST MORTGAGE": "Maple Trust Mortgage",
}

# Generator-internal: classify() uses these to categorize the mock
# transactions. They are not emitted in fixtures.json (issue #6).
RULES: list[dict[str, Any]] = [
    {"id": "r1",  "matcher": {"kind": "contains", "value": "MAPLE TRUST MORTGAGE"},      "categoryId": "housing",         "order": 1},
    {"id": "r2",  "matcher": {"kind": "contains", "value": "PROPERTY TAX"},     "categoryId": "housing",         "order": 2},
    {"id": "r3",  "matcher": {"kind": "contains", "value": "ENBRIDGE"},         "categoryId": "utilities",       "order": 3},
    {"id": "r4",  "matcher": {"kind": "contains", "value": "HYDRO"},            "categoryId": "utilities",       "order": 4},
    {"id": "r5",  "matcher": {"kind": "contains", "value": "ROGERS"},           "categoryId": "phone_internet",  "order": 5},
    {"id": "r6",  "matcher": {"kind": "contains", "value": "BELL CANADA"},      "categoryId": "phone_internet",  "order": 6},
    {"id": "r7",  "matcher": {"kind": "contains", "value": "TELUS"},            "categoryId": "phone_internet",  "order": 7},
    {"id": "r8",  "matcher": {"kind": "contains", "value": "SHAW"},             "categoryId": "phone_internet",  "order": 8},
    {"id": "r9",  "matcher": {"kind": "contains", "value": "GOODLIFE"},         "categoryId": "gym",             "order": 9},
    {"id": "r10", "matcher": {"kind": "contains", "value": "Daycare"},          "categoryId": "childcare",       "order": 10},
    {"id": "r11", "matcher": {"kind": "contains", "value": "INSURANCE"},        "categoryId": "insurance",       "order": 11},
    {"id": "r12", "matcher": {"kind": "contains", "value": "INS"},              "categoryId": "insurance",       "order": 12},
    {"id": "r13", "matcher": {"kind": "contains", "value": "NETFLIX"},          "categoryId": "subscriptions",   "order": 13},
    {"id": "r14", "matcher": {"kind": "contains", "value": "DISNEY"},           "categoryId": "subscriptions",   "order": 14},
    {"id": "r15", "matcher": {"kind": "contains", "value": "CRAVE"},            "categoryId": "subscriptions",   "order": 15},
    {"id": "r16", "matcher": {"kind": "contains", "value": "SPOTIFY"},          "categoryId": "subscriptions",   "order": 16},
    {"id": "r17", "matcher": {"kind": "contains", "value": "AMZN PRIME"},       "categoryId": "subscriptions",   "order": 17},
    {"id": "r18", "matcher": {"kind": "contains", "value": "ICLOUD"},           "categoryId": "subscriptions",   "order": 18},
    {"id": "r19", "matcher": {"kind": "contains", "value": "LOBLAWS"},          "categoryId": "groceries",       "order": 19},
    {"id": "r20", "matcher": {"kind": "contains", "value": "NO FRILLS"},        "categoryId": "groceries",       "order": 20},
    {"id": "r21", "matcher": {"kind": "contains", "value": "COSTCO"},           "categoryId": "groceries",       "order": 21},
    {"id": "r22", "matcher": {"kind": "contains", "value": "SUPERSTORE"},       "categoryId": "groceries",       "order": 22},
    {"id": "r23", "matcher": {"kind": "contains", "value": "FARM BOY"},         "categoryId": "groceries",       "order": 23},
    {"id": "r24", "matcher": {"kind": "contains", "value": "T&T"},              "categoryId": "groceries",       "order": 24},
    {"id": "r25", "matcher": {"kind": "contains", "value": "TIM HORTONS"},      "categoryId": "dining",          "order": 25},
    {"id": "r26", "matcher": {"kind": "contains", "value": "STARBUCKS"},        "categoryId": "dining",          "order": 26},
    {"id": "r27", "matcher": {"kind": "contains", "value": "A&W"},              "categoryId": "dining",          "order": 27},
    {"id": "r28", "matcher": {"kind": "contains", "value": "MCDONALD"},         "categoryId": "dining",          "order": 28},
    {"id": "r29", "matcher": {"kind": "contains", "value": "BOSTON PIZZA"},     "categoryId": "dining",          "order": 29},
    {"id": "r30", "matcher": {"kind": "contains", "value": "PIZZA HUT"},        "categoryId": "dining",          "order": 30},
    {"id": "r31", "matcher": {"kind": "contains", "value": "CAFETERIA"},           "categoryId": "dining",          "order": 31},
    {"id": "r32", "matcher": {"kind": "contains", "value": "PETRO-CANADA"},     "categoryId": "transportation",  "order": 32},
    {"id": "r33", "matcher": {"kind": "contains", "value": "ESSO"},             "categoryId": "transportation",  "order": 33},
    {"id": "r34", "matcher": {"kind": "contains", "value": "SHELL"},            "categoryId": "transportation",  "order": 34},
    {"id": "r35", "matcher": {"kind": "contains", "value": "PRESTO"},           "categoryId": "transportation",  "order": 35},
    {"id": "r36", "matcher": {"kind": "contains", "value": "UBER"},             "categoryId": "transportation",  "order": 36},
    {"id": "r37", "matcher": {"kind": "contains", "value": "PARKING"},          "categoryId": "transportation",  "order": 37},
    {"id": "r38", "matcher": {"kind": "contains", "value": "AMZN"},             "categoryId": "shopping",        "order": 38},
    {"id": "r39", "matcher": {"kind": "contains", "value": "AMAZON"},           "categoryId": "shopping",        "order": 39},
    {"id": "r40", "matcher": {"kind": "contains", "value": "CANADIAN TIRE"},    "categoryId": "shopping",        "order": 40},
    {"id": "r41", "matcher": {"kind": "contains", "value": "HOME DEPOT"},       "categoryId": "shopping",        "order": 41},
    {"id": "r42", "matcher": {"kind": "contains", "value": "HUDSON"},           "categoryId": "shopping",        "order": 42},
    {"id": "r43", "matcher": {"kind": "contains", "value": "INDIGO"},           "categoryId": "shopping",        "order": 43},
    {"id": "r44", "matcher": {"kind": "contains", "value": "WAYFAIR"},          "categoryId": "shopping",        "order": 44},
    {"id": "r45", "matcher": {"kind": "contains", "value": "MASTERMIND"},       "categoryId": "kids",            "order": 45},
    {"id": "r46", "matcher": {"kind": "contains", "value": "WALMART KIDS"},     "categoryId": "kids",            "order": 46},
    {"id": "r47", "matcher": {"kind": "contains", "value": "CINEPLEX"},         "categoryId": "entertainment",   "order": 47},
    {"id": "r48", "matcher": {"kind": "contains", "value": "RECREATION"},       "categoryId": "entertainment",   "order": 48},
    {"id": "r49", "matcher": {"kind": "contains", "value": "GREAT CLIPS"},      "categoryId": "personal_care",   "order": 49},
    {"id": "r50", "matcher": {"kind": "contains", "value": "SEPHORA"},          "categoryId": "personal_care",   "order": 50},
    {"id": "r51", "matcher": {"kind": "contains", "value": "SHOPPERS DRUG"},    "categoryId": "healthcare",      "order": 51},
    {"id": "r52", "matcher": {"kind": "contains", "value": "REXALL"},           "categoryId": "healthcare",      "order": 52},
    {"id": "r53", "matcher": {"kind": "contains", "value": "DENTISTRY"},        "categoryId": "healthcare",      "order": 53},
    {"id": "r54", "matcher": {"kind": "contains", "value": "AIR CANADA"},       "categoryId": "travel",          "order": 54},
    {"id": "r55", "matcher": {"kind": "contains", "value": "WESTJET"},          "categoryId": "travel",          "order": 55},
    {"id": "r56", "matcher": {"kind": "contains", "value": "AIRBNB"},           "categoryId": "travel",          "order": 56},
    {"id": "r57", "matcher": {"kind": "contains", "value": "GIFTS"},            "categoryId": "gifts",           "order": 57},
    {"id": "r58", "matcher": {"kind": "contains", "value": "PAYROLL"},          "categoryId": "salary",          "order": 58},
    {"id": "r59", "matcher": {"kind": "contains", "value": "CCB"},              "categoryId": "ccb",             "order": 59},
    {"id": "r60", "matcher": {"kind": "contains", "value": "TAX REFUND"},       "categoryId": "tax_refund",      "order": 60},
    {"id": "r61", "matcher": {"kind": "contains", "value": "INTEREST CREDIT"},  "categoryId": "interest",        "order": 61},
    {"id": "r62", "matcher": {"kind": "contains", "value": "CC PAYMENT"},       "categoryId": "cc_payment",      "order": 62},
    {"id": "r63", "matcher": {"kind": "contains", "value": "SSV TO"},           "categoryId": "transfer",        "order": 63},
    {"id": "r64", "matcher": {"kind": "contains", "value": "E-TFR"},            "categoryId": "transfer",        "order": 64},
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def resolve_alias(raw: str) -> str:
    if raw in ALIASES:
        return ALIASES[raw]
    cleaned = raw.split("#")[0].strip().rstrip(",.").title()
    return cleaned or raw


def classify(raw: str) -> str:
    upper = raw.upper()
    for rule in RULES:
        if rule["matcher"]["kind"] == "contains" and rule["matcher"]["value"].upper() in upper:
            return rule["categoryId"]
    return "unclassified"


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def fmt_csv_date(d: date) -> str:
    """User CSV format is MM/DD/YYYY (matching their credit-card example)."""
    return d.strftime("%m/%d/%Y")


def end_of_month(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def months_window(num_months: int, today: date) -> list[tuple[int, int]]:
    """Return [(year, month), ...] for the trailing num_months ending at today's month."""
    months: list[tuple[int, int]] = []
    y, m = today.year, today.month
    for _ in range(num_months):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(months))


# ---------------------------------------------------------------------------
# Transaction generation
# ---------------------------------------------------------------------------

# Internal representation: signed amount, ISO date, account_id reference.
# Positive amount = inflow (deposit / income / refund).
# Negative amount = outflow (withdrawal / charge / contribution).


def make_tx(
    *,
    txid: str,
    d: date,
    account_id: str,
    raw_merchant: str,
    amount: float,
    person_id: str | None = None,
    is_transfer: bool = False,
) -> dict[str, Any]:
    return {
        "id": txid,
        "date": iso(d),
        "accountId": account_id,
        "rawMerchant": raw_merchant,
        "merchant": resolve_alias(raw_merchant),
        "amount": round(amount, 2),
        "categoryId": classify(raw_merchant),
        "personId": person_id,
        "isTransfer": is_transfer,
    }


def gen_income_for_month(year: int, month: int, rng: random.Random, counter: list[int]) -> list[dict[str, Any]]:
    txs: list[dict[str, Any]] = []
    eom = end_of_month(year, month)

    # Avery biweekly salary into his chequing — 15th & last day
    for d in [date(year, month, 15), eom]:
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id="chequing_1",
            raw_merchant="PAYROLL DEP NORTHWIND",
            amount=3900 + rng.uniform(-60, 60),
            person_id="p_adult1",
        ))

    # Jordan biweekly salary into her chequing — 14th & 28th-ish
    for d_offset in (14, 28):
        d = date(year, month, min(d_offset, eom.day))
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id="chequing_2",
            raw_merchant="PAYROLL DEP CEDARCARE",
            amount=2300 + rng.uniform(-40, 40),
            person_id="p_adult2",
        ))

    # CCB into joint savings on the 20th
    counter[0] += 1
    txs.append(make_tx(
        txid=f"t{counter[0]}",
        d=date(year, month, 20),
        account_id="savings_joint",
        raw_merchant="CCB DEPOSIT CANADA",
        amount=512.75,
        person_id="p_adult2",
    ))

    # Tax refund — once a year in April
    if month == 4:
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, 4, 22),
            account_id="chequing_1",
            raw_merchant="CRA TAX REFUND",
            amount=1935.00,
            person_id="p_adult1",
        ))

    # Quarterly interest credits on savings
    if month in (3, 6, 9, 12):
        for acc, amt in [("savings_1", 31.40), ("savings_joint", 74.20)]:
            counter[0] += 1
            txs.append(make_tx(
                txid=f"t{counter[0]}",
                d=eom,
                account_id=acc,
                raw_merchant="INTEREST CREDIT",
                amount=amt + rng.uniform(-3, 3),
            ))

    return txs


# Recurring monthly bank-account expenses (mortgage, utilities, daycare, insurance)
# Distributed across both adults' chequing accounts so neither one goes negative.
RECURRING_BANK: list[dict[str, Any]] = [
    # Avery's chequing pays the mortgage + most utilities + his subscriptions
    {"day": 1,  "account": "chequing_1", "merchant": "MAPLE TRUST MORTGAGE",     "amount": 2185.00},
    {"day": 5,  "account": "chequing_1", "merchant": "ENBRIDGE GAS",             "amount": 74.25},
    {"day": 6,  "account": "chequing_1", "merchant": "HYDRO ONE",                "amount": 138.60},
    {"day": 8,  "account": "chequing_1", "merchant": "ROGERS COMMUNICATIONS",    "amount": 96.99},
    {"day": 9,  "account": "chequing_1", "merchant": "BELL CANADA",              "amount": 71.25},
    {"day": 12, "account": "chequing_1", "merchant": "MAPLE TRUST INS/ASSUR INS","amount": 154.20},
    {"day": 3,  "account": "chequing_1", "merchant": "GOODLIFE CLUBS  #2214",    "amount": 58.99},
    # Jordan's chequing pays daycare (both kids), home insurance, second cell line
    {"day": 2,  "account": "chequing_2", "merchant": "Sunnybrook Daycare  FEE",  "amount": 1180.00},
    {"day": 2,  "account": "chequing_2", "merchant": "Little Pines Day  FEE",    "amount": 1225.00},
    {"day": 14, "account": "chequing_2", "merchant": "INTACT INSURANCE HOME",    "amount": 108.50},
    {"day": 10, "account": "chequing_2", "merchant": "TELUS MOBILITY",           "amount": 58.00},
]

# Recurring monthly subscriptions billed to credit cards
RECURRING_CC_SUBS: list[dict[str, Any]] = [
    {"day": 4,  "account": "cc_rewards_1", "merchant": "NETFLIX.COM",          "amount": 19.99},
    {"day": 7,  "account": "cc_rewards_1", "merchant": "DISNEY PLUS",          "amount": 16.79},
    {"day": 11, "account": "cc_rewards_1", "merchant": "CRAVE",                "amount": 19.99},
    {"day": 14, "account": "cc_rewards_1", "merchant": "SPOTIFY R4T7QWZ2",     "amount": 12.99},
    {"day": 18, "account": "cc_visa_1",     "merchant": "AMZN PRIME CA*KT4",    "amount": 10.49},
    {"day": 22, "account": "cc_visa_1",     "merchant": "APPLE.COM/BILL ICLOUD","amount":  3.99},
]


def gen_recurring_for_month(year: int, month: int, rng: random.Random, counter: list[int]) -> list[dict[str, Any]]:
    txs: list[dict[str, Any]] = []
    eom = end_of_month(year, month)
    for r in RECURRING_BANK:
        d = date(year, month, min(r["day"], eom.day))
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id=r["account"],
            raw_merchant=r["merchant"],
            amount=-r["amount"],
        ))
    for r in RECURRING_CC_SUBS:
        d = date(year, month, min(r["day"], eom.day))
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id=r["account"],
            raw_merchant=r["merchant"],
            amount=-r["amount"],
        ))
    # Quarterly property tax in Mar/Jun/Sep/Dec
    if month in (3, 6, 9, 12):
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, 15),
            account_id="chequing_1",
            raw_merchant="PROPERTY TAX CITY",
            amount=-995.00,
        ))
    return txs


def gen_variable_for_month(year: int, month: int, rng: random.Random, counter: list[int]) -> list[dict[str, Any]]:
    """Weekly groceries, gas, dining, occasional shopping, seasonal travel."""
    txs: list[dict[str, Any]] = []
    eom = end_of_month(year, month)

    # weekly groceries on Saturdays
    for day in range(1, eom.day + 1):
        d = date(year, month, day)
        if d.weekday() == 5:  # Saturday
            counter[0] += 1
            txs.append(make_tx(
                txid=f"t{counter[0]}",
                d=d,
                account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
                raw_merchant=rng.choice(MERCHANTS["groceries"]),
                amount=-round(rng.uniform(140, 240), 2),
            ))
        if d.weekday() == 1:  # Tuesday — top-up groceries
            counter[0] += 1
            txs.append(make_tx(
                txid=f"t{counter[0]}",
                d=d,
                account_id=rng.choice(["cc_visa_1", "cc_travel_2"]),
                raw_merchant=rng.choice(MERCHANTS["groceries"]),
                amount=-round(rng.uniform(40, 90), 2),
            ))

    # gas ~weekly
    for _ in range(4):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_visa_1", "cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["transportation"]),
            amount=-round(rng.uniform(55, 95), 2),
        ))

    # dining 2-4x per week, mostly small
    n_dining = rng.randint(8, 16)
    for _ in range(n_dining):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_visa_1", "cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["dining"]),
            amount=-round(rng.uniform(6, 65), 2),
        ))

    # shopping bursts — 3-7 per month
    for _ in range(rng.randint(3, 7)):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["shopping"]),
            amount=-round(rng.uniform(15, 280), 2),
        ))

    # kids stuff
    for _ in range(rng.randint(1, 3)):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["kids"]),
            amount=-round(rng.uniform(25, 120), 2),
        ))

    # entertainment 1-2 per month
    for _ in range(rng.randint(0, 2)):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["entertainment"]),
            amount=-round(rng.uniform(20, 90), 2),
        ))

    # personal care 1-2 per month
    for _ in range(rng.randint(0, 2)):
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["personal_care"]),
            amount=-round(rng.uniform(20, 85), 2),
        ))

    # healthcare ~once per month
    if rng.random() < 0.7:
        day = rng.randint(1, eom.day)
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, day),
            account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
            raw_merchant=rng.choice(MERCHANTS["healthcare"]),
            amount=-round(rng.uniform(15, 130), 2),
        ))

    # travel — heavy in Jul/Aug, December
    if month in (7, 8):
        counter[0] += 1
        txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=date(year, month, rng.randint(5, 20)),
            account_id="cc_rewards_1",
            raw_merchant=rng.choice(MERCHANTS["travel"]),
            amount=-round(rng.uniform(800, 2200), 2),
        ))
    if month == 12:
        # December gift spending
        for _ in range(rng.randint(3, 6)):
            day = rng.randint(1, 22)
            counter[0] += 1
            txs.append(make_tx(
                txid=f"t{counter[0]}",
                d=date(year, month, day),
                account_id=rng.choice(["cc_rewards_1", "cc_travel_2"]),
                raw_merchant=rng.choice(MERCHANTS["gifts"]),
                amount=-round(rng.uniform(40, 250), 2),
            ))

    return txs


def gen_cc_payments_for_month(
    year: int,
    month: int,
    cc_balance_at_start: dict[str, float],
    txs_this_month: list[dict[str, Any]],
    counter: list[int],
) -> list[dict[str, Any]]:
    """Pay each credit card statement balance in full from chequing on the 25th.

    The statement balance is the prior-month balance carried in. We pay it in
    full, then the new month's charges accumulate against the next statement.
    """
    payments: list[dict[str, Any]] = []
    pay_day = date(year, month, 25)
    for cc_id, balance in cc_balance_at_start.items():
        if balance <= 0:
            continue
        amount = round(balance, 2)
        # Outflow from chequing
        counter[0] += 1
        payments.append(make_tx(
            txid=f"t{counter[0]}",
            d=pay_day,
            account_id="chequing_1" if cc_id != "cc_travel_2" else "chequing_2",
            raw_merchant=f"CC PAYMENT {cc_id.upper()}",
            amount=-amount,
            is_transfer=True,
        ))
        # Inflow (payment) on the credit card
        counter[0] += 1
        payments.append(make_tx(
            txid=f"t{counter[0]}",
            d=pay_day,
            account_id=cc_id,
            raw_merchant="PAYMENT - THANK YOU",
            amount=+amount,
            is_transfer=True,
        ))
    return payments


# ---------------------------------------------------------------------------
# Investments: contributions, CESG, monthly snapshots
# ---------------------------------------------------------------------------

CONTRIBUTION_PLAN: list[dict[str, Any]] = [
    # account_id, person_id, kind, monthly_amount, start_day
    {"accountId": "tfsa_1", "personId": "p_adult1", "kind": "tfsa", "monthly": 250, "day": 16},
    {"accountId": "tfsa_2", "personId": "p_adult1", "kind": "tfsa", "monthly": 175, "day": 17},
    {"accountId": "tfsa_4", "personId": "p_adult2", "kind": "tfsa", "monthly": 225, "day": 16},
    {"accountId": "rrsp_1", "personId": "p_adult1", "kind": "rrsp", "monthly": 180, "day": 18},
    {"accountId": "rrsp_2", "personId": "p_adult2", "kind": "rrsp", "monthly": 140, "day": 19},
    {"accountId": "resp_1",   "personId": "p_adult1", "kind": "resp", "monthly": 208, "day": 20, "beneficiaryId": "p_child1"},
    {"accountId": "resp_2",   "personId": "p_adult1", "kind": "resp", "monthly": 208, "day": 20, "beneficiaryId": "p_child2"},
    {"accountId": "fhsa_1", "personId": "p_adult1", "kind": "fhsa", "monthly": 150, "day": 21},
    {"accountId": "fhsa_2", "personId": "p_adult2", "kind": "fhsa", "monthly": 150, "day": 21},
]


def gen_contributions_for_month(
    year: int, month: int, counter: list[int]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (contribution_events, cesg_grants, bank_outflow_txs)."""
    contributions: list[dict[str, Any]] = []
    cesgs: list[dict[str, Any]] = []
    bank_txs: list[dict[str, Any]] = []
    eom = end_of_month(year, month)

    for plan in CONTRIBUTION_PLAN:
        d = date(year, month, min(plan["day"], eom.day))
        counter[0] += 1
        ev = {
            "id": f"c{counter[0]}",
            "date": iso(d),
            "accountId": plan["accountId"],
            "personId": plan["personId"],
            "amount": plan["monthly"],
            "kind": plan["kind"],
        }
        if "beneficiaryId" in plan:
            ev["beneficiaryId"] = plan["beneficiaryId"]
        contributions.append(ev)

        # Bank outflow (contribution leaves chequing)
        from_acc = "chequing_1" if plan["personId"] == "p_adult1" else "chequing_2"
        counter[0] += 1
        bank_txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id=from_acc,
            raw_merchant=f"E-TFR CONTRIB {plan['kind'].upper()}",
            amount=-plan["monthly"],
            person_id=plan["personId"],
            is_transfer=True,
        ))

        # CESG grant the next month after a RESP contribution
        if plan["kind"] == "resp":
            grant_amt = round(plan["monthly"] * CRA_LIMITS_2025["CESG_RATE"], 2)
            counter[0] += 1
            grant_d = d + timedelta(days=20)
            cesgs.append({
                "id": f"g{counter[0]}",
                "date": iso(grant_d),
                "beneficiaryId": plan["beneficiaryId"],
                "contributionEventId": ev["id"],
                "amount": grant_amt,
                "accountId": plan["accountId"],
            })

    # Avery's RRSP February lump-sum contribution
    if month == 2:
        counter[0] += 1
        d = date(year, 2, 27)
        ev = {
            "id": f"c{counter[0]}",
            "date": iso(d),
            "accountId": "rrsp_1",
            "personId": "p_adult1",
            "amount": 3500,
            "kind": "rrsp",
        }
        contributions.append(ev)
        counter[0] += 1
        bank_txs.append(make_tx(
            txid=f"t{counter[0]}",
            d=d,
            account_id="chequing_1",
            raw_merchant="E-TFR CONTRIB RRSP LUMP",
            amount=-3500,
            person_id="p_adult1",
            is_transfer=True,
        ))

    # Cedarlife DCCP (employer pension) Avery payroll deduction — counted as RRSP-like
    counter[0] += 1
    d = end_of_month(year, month)
    contributions.append({
        "id": f"c{counter[0]}",
        "date": iso(d),
        "accountId": "dcpp_1",
        "personId": "p_adult1",
        "amount": 640,
        "kind": "rrsp",
    })

    return contributions, cesgs, bank_txs


# Investment account growth model
INV_GROWTH: dict[str, tuple[float, float]] = {
    # account_id: (mean monthly return, sd)
    "tfsa_1":   (0.007, 0.025),
    "crypto_1": (0.012, 0.10),
    "tfsa_2":   (0.007, 0.025),
    "rrsp_1":   (0.006, 0.022),
    "resp_1":     (0.005, 0.020),
    "resp_2":     (0.005, 0.020),
    "tfsa_3":   (0.006, 0.022),
    "dcpp_1":   (0.005, 0.018),
    "tfsa_4":   (0.007, 0.024),
    "rrsp_2":   (0.006, 0.022),
    "fhsa_1":   (0.006, 0.020),
    "fhsa_2":   (0.006, 0.020),
}

INV_STARTING_VALUES: dict[str, float] = {
    "tfsa_1":    6200,
    "crypto_1":  4100,
    "tfsa_2":   15400,
    "rrsp_1":   19700,
    "resp_1":    3900,
    "resp_2":    2350,
    "tfsa_3":    5100,
    "dcpp_1":  128000,
    "tfsa_4":    4700,
    "rrsp_2":    6300,
    "fhsa_1":    3100,
    "fhsa_2":    4200,
}


def step_investments(
    prev: dict[str, float],
    contribs_this_month: dict[str, float],
    cesg_this_month: dict[str, float],
    rng: random.Random,
) -> dict[str, float]:
    new: dict[str, float] = {}
    for acc_id, prev_val in prev.items():
        mu, sigma = INV_GROWTH[acc_id]
        ret = rng.gauss(mu, sigma)
        grown = prev_val * (1 + ret)
        added = contribs_this_month.get(acc_id, 0) + cesg_this_month.get(acc_id, 0)
        new[acc_id] = round(max(0, grown + added), 2)
    return new


# ---------------------------------------------------------------------------
# Running totals
# ---------------------------------------------------------------------------

OPENING_BALANCES: dict[str, float] = {
    "chequing_1": 11250.00,
    "savings_1": 18400.00,
    "chequing_2": 7650.00,
    "savings_joint": 35200.00,
    "cc_visa_1": 0.00,
    "cc_rewards_1": 0.00,
    "cc_travel_2": 0.00,
}


def assign_running_totals(transactions: list[dict[str, Any]]) -> None:
    """Mutates each transaction in-place to add a runningTotal field per account.

    For chequing/savings, runningTotal is the cash balance.
    For credit cards, runningTotal is the amount owed (positive when in debt).
    """
    accounts_by_id = {a["id"]: a for a in ACCOUNTS}
    by_account: dict[str, list[dict[str, Any]]] = {}
    for t in transactions:
        by_account.setdefault(t["accountId"], []).append(t)
    for acc_id, txs in by_account.items():
        txs.sort(key=lambda t: (t["date"], t["id"]))
        is_cc = accounts_by_id[acc_id]["kind"] == "credit_card"
        balance = OPENING_BALANCES.get(acc_id, 0.0)
        for t in txs:
            balance += t["amount"]
            # On a CC the displayed running balance is the amount owed: invert.
            t["runningTotal"] = round(-balance if is_cc else balance, 2)


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------


def write_bank_csv(transactions: list[dict[str, Any]], path: Path) -> None:
    cash_kinds = {"chequing", "savings"}
    bank_account_ids = {a["id"] for a in ACCOUNTS if a["kind"] in cash_kinds}
    rows = [t for t in transactions if t["accountId"] in bank_account_ids]
    rows.sort(key=lambda t: (t["accountId"], t["date"], t["id"]), reverse=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Transaction_detail", "withdrawal", "deposit", "running_total", "account"])
        for t in rows:
            d = date.fromisoformat(t["date"])
            withdrawal = f"{-t['amount']:.2f}" if t["amount"] < 0 else ""
            deposit    = f"{t['amount']:.2f}"  if t["amount"] > 0 else ""
            w.writerow([
                fmt_csv_date(d),
                t["rawMerchant"],
                withdrawal,
                deposit,
                f"{t['runningTotal']:.2f}",
                t["accountId"],
            ])


def write_credit_card_csv(transactions: list[dict[str, Any]], path: Path) -> None:
    cc_account_ids = [a["id"] for a in ACCOUNTS if a["kind"] == "credit_card"]
    rows = [t for t in transactions if t["accountId"] in cc_account_ids]
    rows.sort(key=lambda t: (t["accountId"], t["date"], t["id"]), reverse=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "merchant", "amount", "payment", "running_total", "account"])
        for t in rows:
            d = date.fromisoformat(t["date"])
            # On a CC, a charge appears as a NEGATIVE internal amount but is shown
            # as a positive figure in the "amount" column; a payment appears as a
            # POSITIVE internal amount and is shown in the "payment" column.
            charge  = f"{-t['amount']:.2f}" if t["amount"] < 0 else ""
            payment = f"{t['amount']:.2f}"  if t["amount"] > 0 else ""
            w.writerow([
                fmt_csv_date(d),
                t["rawMerchant"],
                charge,
                payment,
                f"{t['runningTotal']:.2f}",
                t["accountId"],
            ])


def write_investments_csv(snapshots: list[dict[str, Any]], path: Path) -> None:
    rows = sorted(snapshots, key=lambda s: (s["date"], s["accountId"]), reverse=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "person", "institution", "account_type", "amount"])
        accounts_by_id = {a["id"]: a for a in ACCOUNTS}
        for s in rows:
            acc = accounts_by_id[s["accountId"]]
            person = acc["ownerIds"][0]
            w.writerow([
                date.fromisoformat(s["date"]).strftime("%Y%m%d"),
                person,
                acc["institution"],
                acc["kind"],
                f"{s['amount']:.0f}",
            ])


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


def default_budget() -> dict[str, Any]:
    """A sensible envelope-mode starting budget the user can tweak in Settings."""
    lines = [
        {"categoryId": "housing",        "monthlyCap": 2900, "rollover": False},
        {"categoryId": "utilities",      "monthlyCap":  280, "rollover": True},
        {"categoryId": "groceries",      "monthlyCap": 1100, "rollover": True},
        {"categoryId": "transportation", "monthlyCap":  420, "rollover": True},
        {"categoryId": "insurance",      "monthlyCap":  300, "rollover": False},
        {"categoryId": "healthcare",     "monthlyCap":  150, "rollover": True},
        {"categoryId": "childcare",      "monthlyCap": 2900, "rollover": False},
        {"categoryId": "phone_internet", "monthlyCap":  260, "rollover": False},
        {"categoryId": "dining",         "monthlyCap":  450, "rollover": True},
        {"categoryId": "entertainment",  "monthlyCap":  120, "rollover": True},
        {"categoryId": "subscriptions",  "monthlyCap":  100, "rollover": False},
        {"categoryId": "shopping",       "monthlyCap":  500, "rollover": True},
        {"categoryId": "personal_care",  "monthlyCap":  120, "rollover": True},
        {"categoryId": "gym",            "monthlyCap":   80, "rollover": False},
        {"categoryId": "travel",         "monthlyCap":  400, "rollover": True},
        {"categoryId": "kids",           "monthlyCap":  250, "rollover": True},
        {"categoryId": "gifts",          "monthlyCap":  150, "rollover": True},
    ]
    return {
        "mode": "envelope",
        "lines": lines,
        "targetSavingsRate": 0.20,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def generate(seed: int, num_months: int, today: date) -> dict[str, Any]:
    rng = random.Random(seed)
    counter = [0]
    months = months_window(num_months, today)

    all_txs: list[dict[str, Any]] = []
    all_contribs: list[dict[str, Any]] = []
    all_cesgs: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []

    inv_values: dict[str, float] = dict(INV_STARTING_VALUES)
    cc_balances_at_start: dict[str, float] = {a["id"]: 0.0 for a in ACCOUNTS if a["kind"] == "credit_card"}

    for (year, month) in months:
        income = gen_income_for_month(year, month, rng, counter)
        recurring = gen_recurring_for_month(year, month, rng, counter)
        variable = gen_variable_for_month(year, month, rng, counter)
        contribs, cesgs, contrib_bank_txs = gen_contributions_for_month(year, month, counter)
        cc_payments = gen_cc_payments_for_month(year, month, cc_balances_at_start, [], counter)

        month_txs = income + recurring + variable + contrib_bank_txs + cc_payments
        all_txs.extend(month_txs)
        all_contribs.extend(contribs)
        all_cesgs.extend(cesgs)

        # Compute end-of-month CC balances for next month's payment.
        # End balance = start balance + charges - payments (clamped at zero).
        cc_account_ids = [a["id"] for a in ACCOUNTS if a["kind"] == "credit_card"]
        new_cc_balances: dict[str, float] = {}
        for cc in cc_account_ids:
            charges = sum(-t["amount"] for t in month_txs if t["accountId"] == cc and t["amount"] < 0)
            payments = sum(t["amount"] for t in month_txs if t["accountId"] == cc and t["amount"] > 0)
            new_cc_balances[cc] = max(0.0, cc_balances_at_start[cc] + charges - payments)
        cc_balances_at_start = new_cc_balances

        # Investments: roll forward
        contribs_by_acc: dict[str, float] = {}
        for c in contribs:
            contribs_by_acc[c["accountId"]] = contribs_by_acc.get(c["accountId"], 0) + c["amount"]
        cesg_by_acc: dict[str, float] = {}
        for g in cesgs:
            cesg_by_acc[g["accountId"]] = cesg_by_acc.get(g["accountId"], 0) + g["amount"]
        inv_values = step_investments(inv_values, contribs_by_acc, cesg_by_acc, rng)

        eom = end_of_month(year, month)
        for acc_id, val in inv_values.items():
            snapshots.append({"date": iso(eom), "accountId": acc_id, "amount": val})

    assign_running_totals(all_txs)

    fixtures = {
        "household": PEOPLE,
        "accounts": ACCOUNTS,
        "categories": CATEGORIES,
        "transactions": all_txs,
        "investments": snapshots,
        "contributionEvents": all_contribs,
        "cesgGrants": all_cesgs,
        "budget": default_budget(),
        "craLimits": CRA_LIMITS_2025,
        "meta": {
            "generatedAt": iso(today),
            "seed": seed,
            "monthsCovered": num_months,
            "openingBalances": OPENING_BALANCES,
        },
    }
    return fixtures


def write_outputs(fixtures: dict[str, Any], out_dir: Path, frontend_data_dir: Path | None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    write_bank_csv(fixtures["transactions"], out_dir / "bank_transactions.csv")
    write_credit_card_csv(fixtures["transactions"], out_dir / "credit_card.csv")
    write_investments_csv(fixtures["investments"], out_dir / "investments.csv")
    fixtures_path = out_dir / "fixtures.json"
    fixtures_path.write_text(json.dumps(fixtures, indent=2), encoding="utf-8")
    if frontend_data_dir is not None:
        frontend_data_dir.mkdir(parents=True, exist_ok=True)
        (frontend_data_dir / "fixtures.json").write_text(json.dumps(fixtures, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate mock DeepPocket data.")
    p.add_argument("--seed", type=int, default=42, help="RNG seed (default 42).")
    p.add_argument("--months", type=int, default=12, help="Number of months to generate (default 12).")
    p.add_argument("--out", type=Path, default=Path("mock/out"), help="Output directory.")
    p.add_argument("--frontend-data", type=Path, default=None,
                   help="Optionally also write fixtures.json into a frontend data dir.")
    p.add_argument("--today", type=str, default=DEFAULT_TODAY,
                   help=f"Anchor date for the 12-month window (default {DEFAULT_TODAY}).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    today = date.fromisoformat(args.today) if args.today else date.today()
    fixtures = generate(seed=args.seed, num_months=args.months, today=today)
    write_outputs(fixtures, args.out, args.frontend_data)
    txs = fixtures["transactions"]
    snaps = fixtures["investments"]
    last_snap_date = max(s["date"] for s in snaps)
    last_total = sum(s["amount"] for s in snaps if s["date"] == last_snap_date)
    print(f"Wrote {len(txs)} transactions, {len(snaps)} investment snapshots, "
          f"{len(fixtures['cesgGrants'])} CESG grants -> {args.out}")
    print(f"Latest investment total ({last_snap_date}): ${last_total:,.2f}")


if __name__ == "__main__":
    main()
