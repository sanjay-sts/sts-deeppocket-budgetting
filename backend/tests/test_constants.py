import pytest

from app.constants import normalize_date, CRA_LIMITS_2025


def test_normalize_date_accepts_us_slash_format():
    assert normalize_date("03/31/2026") == "2026-03-31"


def test_normalize_date_existing_formats_still_work():
    assert normalize_date("20260331") == "2026-03-31"
    assert normalize_date("2026-03-31") == "2026-03-31"


def test_normalize_date_rejects_garbage():
    with pytest.raises(ValueError):
        normalize_date("31-03-2026")


def test_normalize_date_rejects_impossible_month():
    # A DD/MM date fed to the MM/DD parser must fail loudly, not become "2026-25-04".
    with pytest.raises(ValueError):
        normalize_date("25/04/2026")


def test_normalize_date_rejects_impossible_calendar_day():
    with pytest.raises(ValueError):
        normalize_date("02/31/2026")  # Feb 31 doesn't exist


def test_normalize_date_day_first():
    assert normalize_date("25/04/2026", day_first=True) == "2026-04-25"
    assert normalize_date("06/04/2026", day_first=True) == "2026-04-06"
    # Non-slash formats are unambiguous; day_first must not disturb them.
    assert normalize_date("2026-03-31", day_first=True) == "2026-03-31"


def test_cra_limits_match_m2_values():
    assert CRA_LIMITS_2025["TFSA_ANNUAL"] == 7000
    assert CRA_LIMITS_2025["CESG_LIFETIME_PER_CHILD"] == 7200
