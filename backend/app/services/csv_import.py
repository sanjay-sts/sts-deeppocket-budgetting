import csv
import io

from sqlmodel import Session, select

from ..constants import normalize_date, normalize_kind, new_id
from ..models import Person, Account, InvestmentSnapshot

REQUIRED = {"date", "person", "institution", "account_type", "amount"}


def _find_person(session: Session, name: str):
    target = name.strip().lower()
    for p in session.exec(select(Person)).all():
        if p.name.strip().lower() == target:
            return p
    return None


def _find_account(session: Session, person_id: str, institution: str, account_type: str):
    return session.exec(select(Account).where(
        Account.person_id == person_id,
        Account.institution == institution,
        Account.account_type == account_type,
    )).first()


def import_investment_csv(text: str, session: Session) -> dict:
    summary = {"created": 0, "updated": 0, "skipped": 0, "errors": []}
    reader = csv.DictReader(io.StringIO(text))
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    if not REQUIRED.issubset(headers):
        summary["errors"].append({
            "row": 0,
            "reason": f"CSV must include columns: {', '.join(sorted(REQUIRED))}",
        })
        return summary

    for i, raw in enumerate(reader, start=1):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            date = normalize_date(row["date"])
            amount = float(row["amount"])
            name, institution, account_type = row["person"], row["institution"], row["account_type"]
            if not (name and institution and account_type):
                raise ValueError("missing person/institution/account_type")
        except (ValueError, KeyError) as e:
            summary["skipped"] += 1
            summary["errors"].append({"row": i, "reason": str(e)})
            continue

        person = _find_person(session, name)
        if not person:
            person = Person(id=new_id("p"), name=name, role="adult")
            session.add(person)
            session.commit()
            session.refresh(person)

        account = _find_account(session, person.id, institution, account_type)
        if not account:
            account = Account(
                id=new_id("acc"), person_id=person.id, institution=institution,
                account_type=account_type, kind=normalize_kind(account_type),
                name=f"{institution} {account_type}",
            )
            session.add(account)
            session.commit()
            session.refresh(account)

        existing = session.exec(select(InvestmentSnapshot).where(
            InvestmentSnapshot.account_id == account.id,
            InvestmentSnapshot.date == date,
        )).first()
        if existing:
            existing.amount = amount
            session.add(existing)
            session.commit()
            summary["updated"] += 1
        else:
            session.add(InvestmentSnapshot(
                id=new_id("snap"), account_id=account.id, date=date, amount=amount))
            session.commit()
            summary["created"] += 1

    return summary
