"""Turn an uploaded file into text, or reject it with an actionable message (issue #16).

Every import endpoint used to call `.decode("utf-8-sig")` directly, so an .xlsx (a binary
zip) raised UnicodeDecodeError and surfaced as a 500. Two failure modes matter here and
they pull in opposite directions:

  * genuinely binary uploads (.xlsx/.xls/PDF/images) — reject, naming the format so the
    user knows to export CSV instead;
  * text that simply isn't UTF-8 — cp1252 statements with accented merchants, or Excel's
    UTF-16 "Unicode Text" export. Rejecting those would trade a crash for lost data, so
    they are decoded, not refused.
"""
from fastapi import HTTPException

# Leading magic bytes → what to call the format in the error message.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"PK\x03\x04", "an Excel workbook (.xlsx)"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "a legacy Excel workbook (.xls)"),
    (b"%PDF-", "a PDF"),
    (b"\x89PNG\r\n\x1a\n", "a PNG image"),
    (b"\xff\xd8\xff", "a JPEG image"),
    (b"GIF8", "a GIF image"),
    (b"\x1f\x8b", "a gzip archive"),
    (b"Rar!\x1a\x07", "a RAR archive"),
    (b"\x7fELF", "a binary program"),
]

_EXPORT_HINT = "Open it in your spreadsheet app and export as CSV, then import that file."


def decode_upload(raw: bytes) -> str:
    """Decode CSV bytes to text. Raises HTTPException(400) for anything that isn't text."""
    if not raw.strip():
        raise HTTPException(400, "That file is empty — export your statement as CSV and try again.")

    for signature, description in _SIGNATURES:
        if raw.startswith(signature):
            raise HTTPException(400, f"This looks like {description}, not a CSV file. {_EXPORT_HINT}")

    # UTF-16 is only safe to try when a BOM says so: the codec happily decodes arbitrary
    # bytes into mojibake otherwise, which would corrupt every row instead of failing.
    encodings = ("utf-8-sig", "cp1252")
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings = ("utf-16", *encodings)

    for encoding in encodings:
        try:
            text = raw.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
        # cp1252 maps almost any byte, so a NUL is the tell that we decoded binary.
        if "\x00" in text:
            continue
        # A saved login/error page decodes perfectly and then parses as one nonsense
        # column, so the header check has to happen here rather than in the CSV reader.
        if text.lstrip()[:512].lower().startswith(("<!doctype", "<html", "<head", "<?xml")):
            raise HTTPException(
                400,
                "This looks like a web page, not a CSV file — your bank may have saved a "
                "login or error page. Sign in, download the statement as CSV, and try again.",
            )
        return text

    raise HTTPException(
        400,
        "Couldn't read this file as text — it appears to be binary, not a CSV. " + _EXPORT_HINT,
    )
