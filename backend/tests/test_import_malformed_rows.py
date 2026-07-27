"""Malformed-but-textual CSVs must degrade to row-level errors, never a 500.

The decode guard (test_import_guards.py) only covers files that aren't CSV at all. These
are real CSVs whose *rows* are wrong — an unquoted comma, a title line above the header,
a spreadsheet's literal "nan" — which reach the parser and used to crash it.
"""
import json

MAPPING = json.dumps({"dateColumn": "Date", "merchantColumn": "Detail", "amountColumn": "Amount"})


def _all_endpoints(content: bytes, name="statement.csv"):
    return [
        ("investments", "/api/import/investments-csv",
         {"files": {"file": (name, content, "text/csv")}}),
        ("transactions", "/api/import/transactions-csv",
         {"files": {"file": (name, content, "text/csv")}}),
        ("preview", "/api/import/transactions-csv/preview",
         {"files": {"file": (name, content, "text/csv")}}),
        ("mapped", "/api/import/transactions-csv/mapped",
         {"files": {"file": (name, content, "text/csv")}, "data": {"mapping": MAPPING}}),
    ]


def test_ragged_row_with_unquoted_comma_never_500s(client):
    """An unquoted comma in a merchant name gives the row more cells than the header."""
    csv_bytes = (
        "date,person,institution,account_type,amount\n"
        "20260131,Avery,northline,tfsa,1000\n"
        "20260201,GROCERY, MART,northline,tfsa,-12.00\n"
    ).encode("utf-8")
    for label, url, kwargs in _all_endpoints(csv_bytes):
        r = client.post(url, **kwargs)
        assert r.status_code != 500, f"{label} returned 500 on a ragged row"


def test_preamble_line_above_the_header_never_500s(client):
    """Plenty of bank exports put a title line above the real header — precisely the shape
    the mapping wizard exists for, and preview is its first call."""
    csv_bytes = (
        "Account Statement - Chequing\n"
        "Date,Detail,Amount\n"
        "2026-01-06,COFFEE,-4.50\n"
        "2026-01-07,PAYROLL,2000.00\n"
    ).encode("utf-8")
    for label, url, kwargs in _all_endpoints(csv_bytes):
        r = client.post(url, **kwargs)
        assert r.status_code != 500, f"{label} returned 500 on a preamble row"

    preview = client.post("/api/import/transactions-csv/preview",
                          files={"file": ("s.csv", csv_bytes, "text/csv")})
    assert preview.status_code == 200
    assert isinstance(preview.json()["sampleRows"], list)


def test_ragged_investments_row_is_skipped_with_a_reason(client):
    csv_bytes = (
        "date,person,institution,account_type,amount\n"
        "20260131,Avery,northline,tfsa,1000\n"
        "20260201,GROCERY, MART,northline,tfsa,-12.00\n"
    ).encode("utf-8")
    r = client.post("/api/import/investments-csv", files={"file": ("i.csv", csv_bytes, "text/csv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 1, body          # the good row still lands
    assert body["skipped"] >= 1, body          # the bad one is reported, not fatal
    assert body["errors"], body


def test_non_finite_amounts_are_rejected_per_row(client):
    """Excel/pandas round-trips write literal nan; 1e400 parses to inf. Either would be
    stored as NULL and poison every KPI that sums it."""
    for bad in ("nan", "inf", "1e400", "-inf"):
        csv_bytes = (
            "date,person,institution,account_type,amount\n"
            f"20260131,Avery,northline,tfsa,{bad}\n"
        ).encode("utf-8")
        r = client.post("/api/import/investments-csv",
                        files={"file": ("i.csv", csv_bytes, "text/csv")})
        assert r.status_code == 200, f"{bad}: {r.text}"
        assert r.json()["created"] == 0, f"{bad} was imported: {r.json()}"
        assert r.json()["skipped"] == 1, f"{bad}: {r.json()}"

    payload = client.get("/api/data").json()
    assert all(isinstance(s["amount"], (int, float)) for s in payload["investments"])
