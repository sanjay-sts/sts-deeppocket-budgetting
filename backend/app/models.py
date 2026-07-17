from typing import Optional
from sqlmodel import SQLModel, Field, UniqueConstraint


class Person(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    role: str  # 'adult' | 'child'
    birth_year: Optional[int] = None


class Account(SQLModel, table=True):
    # Ownership and RESP beneficiaries are multi-valued (a joint account can have several
    # owners; a family RESP can have several beneficiaries), so they live in the
    # AccountOwner / AccountBeneficiary join tables, not as scalar FKs here. The natural
    # key (institution, account_type, owner-id-set, beneficiary-id-set) is enforced in
    # app code (routers/accounts.py, services/csv_import.py), not as a DB constraint.
    id: str = Field(primary_key=True)
    institution: str
    account_type: str          # free text, e.g. "dccp2"
    kind: str                  # a legal AccountKind value (see constants)
    # Optional custom-name override. When None, the display name is COMPUTED on read
    # as "{owners} {institution} {account_type}" (see services/fixtures._account_out),
    # so it stays in sync when a person is renamed / owners change / type changes.
    custom_name: Optional[str] = None
    is_liability: bool = False
    # Bank-account starting balance (from the M1 meta.openingBalances block); feeds the
    # payload's meta.openingBalances, which lib/kpi.ts cash math depends on.
    opening_balance: float = 0.0


class AccountOwner(SQLModel, table=True):
    account_id: str = Field(foreign_key="account.id", primary_key=True)
    person_id: str = Field(foreign_key="person.id", primary_key=True)


class AccountBeneficiary(SQLModel, table=True):
    account_id: str = Field(foreign_key="account.id", primary_key=True)
    person_id: str = Field(foreign_key="person.id", primary_key=True)


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


class Category(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    group: str                          # CategoryGroup value, e.g. 'essentials'
    bucket503020: Optional[str] = None  # 'needs' | 'wants' | 'savings'
    is_essential: bool = False


class Transaction(SQLModel, table=True):
    # Bank facts (date/amount/merchant/account) are immutable by design; only
    # category_id, is_transfer, is_duplicate, notes, tags are user-editable.
    # No uniqueness on (account, date, merchant, amount): two identical purchases in a
    # day are legitimate — dedup is an import-time check, not a DB rule.
    id: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    date: str = Field(index=True)       # ISO 'YYYY-MM-DD'
    raw_merchant: str
    merchant: str
    amount: float                       # expense < 0, inflow > 0
    category_id: str = Field(foreign_key="category.id", index=True)
    person_id: Optional[str] = Field(default=None, foreign_key="person.id")
    is_transfer: bool = False
    is_duplicate: bool = False
    notes: Optional[str] = None
    tags: Optional[str] = None          # JSON-encoded list[str]
    running_total: Optional[float] = None


class Rule(SQLModel, table=True):
    # Categorization rule: keyword matched case-insensitively as a substring against a
    # transaction's raw_merchant + merchant. Newest rule wins (order by created_at desc).
    id: str = Field(primary_key=True)
    keyword: str
    category_id: str = Field(foreign_key="category.id")
    created_at: str                     # ISO timestamp


class BudgetLine(SQLModel, table=True):
    category_id: str = Field(foreign_key="category.id", primary_key=True)
    monthly_cap: float
    rollover: bool = False


class BudgetConfig(SQLModel, table=True):
    # Single row (id=1): budget mode + optional savings-rate target.
    id: int = Field(default=1, primary_key=True)
    mode: str                           # 'envelope' | 'zero_based' | 'fifty_thirty_twenty'
    target_savings_rate: Optional[float] = None


class AppMeta(SQLModel, table=True):
    # Key-value bag for the payload's meta block (generatedAt / seed / monthsCovered).
    key: str = Field(primary_key=True)
    value: str
