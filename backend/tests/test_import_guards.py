"""Uploads that aren't UTF-8 CSV must fail with an actionable 400, never a 500 (issue #16).

Equally important: a real bank export that merely isn't UTF-8 (cp1252 accents, a UTF-16
"Unicode text" export from Excel) must still import — rejecting those would trade a crash
for silent data loss.
"""
import json

XLSX = b"PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00\x8f\xb2\xd1\x91" + bytes(range(256)) * 4
XLS_LEGACY = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(range(256))
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n" + bytes(range(256))
PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256))

INVESTMENTS_CSV = (
    "date,person,institution,account_type,amount\n"
    "20260430,Avery,northline,tfsa,10554\n"
)
MAPPING = json.dumps({"dateColumn": "Date", "merchantColumn": "Detail", "amountColumn": "Amount"})


def _endpoints(content: bytes, filename: str):
    """Every upload endpoint, as (label, kwargs-for-client.post) pairs."""
    return [
        ("investments", "/api/import/investments-csv",
         {"files": {"file": (filename, content, "application/octet-stream")}}),
        ("transactions", "/api/import/transactions-csv",
         {"files": {"file": (filename, content, "application/octet-stream")}}),
        ("preview", "/api/import/transactions-csv/preview",
         {"files": {"file": (filename, content, "application/octet-stream")}}),
        ("mapped", "/api/import/transactions-csv/mapped",
         {"files": {"file": (filename, content, "application/octet-stream")},
          "data": {"mapping": MAPPING}}),
    ]


def _detail(resp):
    body = resp.json()
    return str(body.get("detail", body))


def test_xlsx_rejected_with_excel_hint_on_every_endpoint(client):
    for label, url, kwargs in _endpoints(XLSX, "investment_accounts_2026.xlsx"):
        r = client.post(url, **kwargs)
        assert r.status_code == 400, f"{label} returned {r.status_code}"
        assert "excel" in _detail(r).lower(), f"{label}: {_detail(r)}"
        assert "csv" in _detail(r).lower(), f"{label}: {_detail(r)}"


def test_legacy_xls_pdf_and_image_rejected(client):
    for content, needle, name in (
        (XLS_LEGACY, "excel", "book.xls"),
        (PDF, "pdf", "statement.pdf"),
        (PNG, "image", "screenshot.png"),
    ):
        r = client.post("/api/import/investments-csv",
                        files={"file": (name, content, "application/octet-stream")})
        assert r.status_code == 400, f"{name} returned {r.status_code}"
        assert needle in _detail(r).lower(), f"{name}: {_detail(r)}"


def test_empty_upload_rejected(client):
    for label, url, kwargs in _endpoints(b"", "empty.csv"):
        r = client.post(url, **kwargs)
        assert r.status_code == 400, f"{label} returned {r.status_code}"
        assert "empty" in _detail(r).lower()


def test_undecodable_binary_rejected_not_500(client):
    # No known signature, still clearly not text.
    blob = bytes([0x8f, 0x00, 0x01, 0xfe, 0x99]) * 200
    r = client.post("/api/import/investments-csv",
                    files={"file": ("mystery.bin", blob, "application/octet-stream")})
    assert r.status_code == 400
    assert "csv" in _detail(r).lower()


def test_cp1252_csv_with_accents_still_imports(client):
    """A Québec bank export is cp1252, not UTF-8 — it must not be mistaken for binary."""
    csv_text = (
        "date,person,institution,account_type,amount\n"
        "20260430,Amélie,société générale,tfsa,10554\n"
    )
    r = client.post("/api/import/investments-csv",
                    files={"file": ("releve.csv", csv_text.encode("cp1252"), "text/csv")})
    assert r.status_code == 200, _detail(r)
    assert r.json()["created"] == 1
    people = [p["name"] for p in client.get("/api/data").json()["household"]]
    assert "Amélie" in people


def test_utf16_export_still_imports(client):
    """Excel's 'Unicode Text' export is UTF-16 with a BOM."""
    r = client.post("/api/import/investments-csv",
                    files={"file": ("unicode.csv", INVESTMENTS_CSV.encode("utf-16"), "text/csv")})
    assert r.status_code == 200, _detail(r)
    assert r.json()["created"] == 1


def test_plain_utf8_csv_unaffected(client):
    r = client.post("/api/import/investments-csv",
                    files={"file": ("investments.csv", INVESTMENTS_CSV.encode("utf-8"), "text/csv")})
    assert r.status_code == 200, _detail(r)
    assert r.json()["created"] == 1


def test_utf8_bom_csv_unaffected(client):
    r = client.post("/api/import/investments-csv",
                    files={"file": ("bom.csv", INVESTMENTS_CSV.encode("utf-8-sig"), "text/csv")})
    assert r.status_code == 200, _detail(r)
    assert r.json()["created"] == 1


def test_preview_still_works_on_valid_csv(client):
    text = "Date,Detail,Amount\n2026-01-05,COFFEE,-4.50\n"
    r = client.post("/api/import/transactions-csv/preview",
                    files={"file": ("t.csv", text.encode("utf-8"), "text/csv")})
    assert r.status_code == 200, _detail(r)
    assert r.json()["headers"] == ["Date", "Detail", "Amount"]


HTML_LOGIN = (
    "<!DOCTYPE html>\n<html><head><title>Sign in</title></head>\n"
    "<body>Your session expired. Please sign in again.</body></html>\n"
).encode("utf-8")


def test_html_error_page_rejected(client):
    """Bank exports sometimes save the login page instead of the statement."""
    for label, url, kwargs in _endpoints(HTML_LOGIN, "statement.csv"):
        r = client.post(url, **kwargs)
        assert r.status_code == 400, f"{label} returned {r.status_code}"
        assert "web page" in _detail(r).lower(), f"{label}: {_detail(r)}"


def test_unterminated_quote_never_500s(client):
    """csv.Error is NOT a ValueError, so the services' row-level `except ValueError` misses
    it: one stray quote in a big export escaped as a 500 from the very first fieldnames read.

    Endpoints that get as far as parsing must now explain the problem; the other two reject
    the file earlier (header sniff / mapping validation). What matters everywhere is that
    nothing 500s.
    """
    broken = ('date,person,institution,account_type,amount\n"' + "x" * 200000).encode("utf-8")
    for label, url, kwargs in _endpoints(broken, "broken.csv"):
        r = client.post(url, **kwargs)
        assert r.status_code != 500, f"{label} still 500s"
        assert r.status_code in (200, 400, 422), f"{label} returned {r.status_code}"

    parsed = client.post("/api/import/investments-csv",
                         files={"file": ("broken.csv", broken, "text/csv")})
    assert parsed.status_code == 400
    assert "quote" in _detail(parsed).lower()
