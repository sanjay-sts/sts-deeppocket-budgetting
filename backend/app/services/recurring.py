"""Materialize recurring contribution schedules into concrete Contribution rows.

Idempotency is two-layered (issue #28): the event id is the natural key
"{schedule_id}:{due_date}", so a due date can never insert twice — and
last_materialized bounds each run to dates not yet processed, so an occurrence
the user deleted is never regenerated.
"""
from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models import Contribution, RecurringContribution


def _due_dates(s: RecurringContribution, today: date):
    start = date.fromisoformat(s.start_date)
    stop = today
    if s.end_date:
        stop = min(stop, date.fromisoformat(s.end_date))
    if s.frequency in ("weekly", "biweekly"):
        step = timedelta(days=7 if s.frequency == "weekly" else 14)
        d = start
        while d <= stop:
            yield d
            d += step
    elif s.frequency == "monthly":
        y, m = start.year, start.month
        while True:
            # keep the start's day-of-month, clamped to short months (31st -> Feb 28)
            d = date(y, m, min(start.day, monthrange(y, m)[1]))
            if d > stop:
                break
            yield d
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    elif s.frequency == "semi_monthly":
        y, m = start.year, start.month
        while date(y, m, 1) <= stop:
            for day in (1, 15):
                d = date(y, m, day)
                if start <= d <= stop:
                    yield d
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def materialize_recurring(session: Session, today: str) -> int:
    t = date.fromisoformat(today)
    created = 0
    for s in session.exec(select(RecurringContribution)).all():
        if not s.paused:
            after = date.fromisoformat(s.last_materialized) if s.last_materialized else None
            for d in _due_dates(s, t):
                if after and d <= after:
                    continue
                event_id = f"{s.id}:{d.isoformat()}"
                if session.get(Contribution, event_id):
                    continue
                session.add(Contribution(
                    id=event_id, account_id=s.account_id, person_id=s.person_id,
                    date=d.isoformat(), amount=s.amount, kind=s.kind,
                    beneficiary_person_id=s.beneficiary_person_id, recurring_id=s.id,
                ))
                created += 1
        # Advance the cursor for paused schedules too: the paused window is consumed,
        # not deferred — deposits that never happened must not appear on resume.
        if not s.last_materialized or today > s.last_materialized:
            s.last_materialized = today
            session.add(s)
    try:
        session.commit()
    except IntegrityError:
        # A concurrent materialization won the race and committed the same events
        # first (both runs walk every schedule, so the batches are identical).
        session.rollback()
        return 0
    return created
