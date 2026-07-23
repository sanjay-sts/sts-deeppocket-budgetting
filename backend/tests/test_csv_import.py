from sqlmodel import select
from app.models import Person, Account, InvestmentSnapshot
from app.services.csv_import import import_investment_csv

HEADER = "date,person,institution,account_type,amount\n"


def test_import_creates_people_accounts_snapshots(session):
    csv_text = HEADER + "20250131,sanjay,questrade,tfsa,10000\n20250131,anumol,wealthsimple,rrsp,5000\n"
    summary = import_investment_csv(csv_text, session)
    assert summary["created"] == 2
    assert summary["skipped"] == 0
    assert len(session.exec(select(Person)).all()) == 2
    assert len(session.exec(select(Account)).all()) == 2
    assert len(session.exec(select(InvestmentSnapshot)).all()) == 2


def test_import_matches_person_case_insensitively(session):
    session.add(Person(id="p1", name="Sanjay", role="adult"))
    session.commit()
    import_investment_csv(HEADER + "20250131,sanjay,questrade,tfsa,10000\n", session)
    assert len(session.exec(select(Person)).all()) == 1  # matched existing "Sanjay"


def test_import_upserts_by_account_date(session):
    import_investment_csv(HEADER + "20250131,sanjay,questrade,tfsa,10000\n", session)
    summary = import_investment_csv(HEADER + "2025-01-31,sanjay,questrade,tfsa,12000\n", session)
    assert summary["updated"] == 1
    snaps = session.exec(select(InvestmentSnapshot)).all()
    assert len(snaps) == 1 and snaps[0].amount == 12000.0


def test_import_infers_kind_from_free_text_type(session):
    import_investment_csv(HEADER + "20250131,sanjay,sunlife,dccp2,42000\n", session)
    acc = session.exec(select(Account)).first()
    assert acc.account_type == "dccp2" and acc.kind == "dcpp"


def test_import_parses_currency_formatted_amounts(session):
    csv_text = HEADER + '20250131,sanjay,questrade,tfsa,"189,301.43"\n20250131,anumol,rbc,rrsp,"$1,234.56"\n'
    summary = import_investment_csv(csv_text, session)
    assert summary["created"] == 2
    assert summary["skipped"] == 0
    amounts = sorted(s.amount for s in session.exec(select(InvestmentSnapshot)).all())
    assert amounts == [1234.56, 189301.43]


def test_import_reports_bad_rows(session):
    summary = import_investment_csv(HEADER + "BADDATE,sanjay,questrade,tfsa,100\n", session)
    assert summary["skipped"] == 1
    assert summary["errors"][0]["row"] == 1


def test_import_rejects_wrong_header(session):
    summary = import_investment_csv("foo,bar\n1,2\n", session)
    assert summary["errors"] and summary["errors"][0]["row"] == 0


def test_import_endpoint_multipart(client):
    csv_bytes = (HEADER + "20250131,sanjay,questrade,tfsa,10000\n").encode("utf-8")
    r = client.post(
        "/api/import/investments-csv",
        files={"file": ("snap.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 200
    assert r.json()["created"] == 1
