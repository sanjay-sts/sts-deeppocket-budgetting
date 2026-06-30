from typing import Optional
from sqlmodel import SQLModel, Field, UniqueConstraint


class Person(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    role: str  # 'adult' | 'child'
    birth_year: Optional[int] = None


class Account(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("person_id", "institution", "account_type", name="uq_account_natural_key"),
    )
    id: str = Field(primary_key=True)
    person_id: str = Field(foreign_key="person.id", index=True)
    institution: str
    account_type: str          # free text, e.g. "dccp2"
    kind: str                  # a legal AccountKind value (see constants)
    name: str
    is_liability: bool = False
    beneficiary_person_id: Optional[str] = Field(default=None, foreign_key="person.id")


class InvestmentSnapshot(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("account_id", "date", name="uq_snapshot_account_date"),
    )
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    date: str                  # ISO 'YYYY-MM-DD'
    amount: float


class Contribution(SQLModel, table=True):
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    person_id: str = Field(foreign_key="person.id")
    date: str                  # ISO 'YYYY-MM-DD'
    amount: float
    kind: str                  # 'tfsa' | 'rrsp' | 'resp' | 'fhsa'
    beneficiary_person_id: Optional[str] = Field(default=None, foreign_key="person.id")
