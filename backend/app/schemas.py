from typing import Optional
from pydantic import BaseModel, ConfigDict


class PersonCreate(BaseModel):
    name: str
    role: str = "adult"
    birthYear: Optional[int] = None


class PersonUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    birthYear: Optional[int] = None


class AccountCreate(BaseModel):
    personIds: list[str]
    institution: str
    accountType: str
    kind: Optional[str] = None
    name: Optional[str] = None
    isLiability: bool = False
    beneficiaryIds: list[str] = []


class AccountUpdate(BaseModel):
    institution: Optional[str] = None
    accountType: Optional[str] = None
    kind: Optional[str] = None
    name: Optional[str] = None
    isLiability: Optional[bool] = None
    personIds: Optional[list[str]] = None
    beneficiaryIds: Optional[list[str]] = None


class SnapshotUpsert(BaseModel):
    accountId: str
    date: str
    amount: float


class SnapshotUpdate(BaseModel):
    date: Optional[str] = None
    amount: Optional[float] = None


class ContributionCreate(BaseModel):
    accountId: str
    personId: str
    date: str
    amount: float
    kind: str
    beneficiaryId: Optional[str] = None


class ContributionUpdate(BaseModel):
    date: Optional[str] = None
    amount: Optional[float] = None
    kind: Optional[str] = None
    beneficiaryId: Optional[str] = None


class TransactionPatch(BaseModel):
    # Bank facts (date/amount/merchant/account) are immutable on source='bank' rows —
    # the router rejects them with 422. On source='manual' rows they are editable.
    # extra="forbid" still turns unknown fields into a 422 instead of a silent ignore.
    model_config = ConfigDict(extra="forbid")

    categoryId: Optional[str] = None
    isTransfer: Optional[bool] = None
    isDuplicate: Optional[bool] = None
    notes: Optional[str] = None      # "" clears
    tags: Optional[list[str]] = None  # [] clears
    # manual-only bank facts:
    date: Optional[str] = None
    merchant: Optional[str] = None
    amount: Optional[float] = None
    accountId: Optional[str] = None


class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accountId: str
    date: str
    merchant: str
    amount: float
    categoryId: Optional[str] = None  # omitted -> auto-categorize
    notes: Optional[str] = None
    tags: Optional[list[str]] = None


class RuleCreate(BaseModel):
    keyword: str
    categoryId: str


class RuleUpdate(BaseModel):
    keyword: Optional[str] = None
    categoryId: Optional[str] = None


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    group: str
    bucket503020: Optional[str] = None
    isEssential: bool = False


class CategoryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    group: Optional[str] = None
    bucket503020: Optional[str] = None  # "" clears
    isEssential: Optional[bool] = None


class BudgetLineUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    monthlyCap: float
    rollover: bool = False


class BudgetConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Optional[str] = None
    targetSavingsRate: Optional[float] = None


class TransactionBulkUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str]
    categoryId: Optional[str] = None
    isTransfer: Optional[bool] = None
    isDuplicate: Optional[bool] = None


class TransactionBulkDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str]


class TransactionCsvMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dateColumn: str
    merchantColumn: str
    # amount: EITHER a single signed column, OR a debit/credit split — validated in the service.
    amountColumn: Optional[str] = None
    amountInvert: bool = False
    debitColumn: Optional[str] = None
    creditColumn: Optional[str] = None
    # account: EITHER a column holding the account id, OR a fixed account id for every row.
    accountColumn: Optional[str] = None
    accountId: Optional[str] = None
    dayFirst: bool = False
