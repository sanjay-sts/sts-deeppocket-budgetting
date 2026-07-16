from typing import Optional
from pydantic import BaseModel


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
