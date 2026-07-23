// Shared types matching mock/out/fixtures.json exactly.
// When Milestone 2 adds a FastAPI backend, the same shapes are served over the wire.

export type PersonId = string;
export type AccountId = string;
export type CategoryId = string;
export type IsoDate = string; // YYYY-MM-DD

export type PersonRole = 'adult' | 'child';

export interface Person {
  id: PersonId;
  name: string;
  role: PersonRole;
  birthYear?: number;
}

export type AccountKind =
  | 'chequing'
  | 'savings'
  | 'credit_card'
  | 'cash'
  | 'tfsa'
  | 'rrsp'
  | 'resp'
  | 'fhsa'
  | 'dcpp'
  | 'non_registered'
  | 'crypto';

export interface Account {
  id: AccountId;
  name: string; // computed display name: custom override, else owners + institution + type
  customName?: string; // present only when a custom name override is set
  kind: AccountKind;
  institution: string;
  accountType?: string;
  ownerIds: PersonId[];
  beneficiaryIds?: PersonId[];
  isLiability?: boolean;
}

export type CategoryGroup =
  | 'essentials'
  | 'lifestyle'
  | 'family'
  | 'financial'
  | 'transfers'
  | 'income';

export type Bucket503020 = 'needs' | 'wants' | 'savings';

export interface Category {
  id: CategoryId;
  name: string;
  group: CategoryGroup;
  bucket503020?: Bucket503020;
  isEssential?: boolean;
}

export type TransactionSource = 'bank' | 'manual';

export interface Transaction {
  id: string;
  date: IsoDate;
  accountId: AccountId;
  rawMerchant: string;
  merchant: string;
  amount: number;
  categoryId: CategoryId;
  source: TransactionSource; // 'bank': imported, facts immutable; 'manual': user-entered, fully editable
  personId?: PersonId | null;
  isTransfer?: boolean;
  isDuplicate?: boolean;
  tags?: string[];
  notes?: string;
  runningTotal?: number;
}

export interface InvestmentSnapshot {
  date: IsoDate;
  accountId: AccountId;
  amount: number;
}

export type ContributionKind = 'tfsa' | 'rrsp' | 'resp' | 'fhsa';

export interface ContributionEvent {
  id: string;
  date: IsoDate;
  accountId: AccountId;
  personId: PersonId;
  amount: number;
  kind: ContributionKind;
  beneficiaryId?: PersonId;
}

// CRA-stated available room (NOA / MyAccount) incl. carry-forward — issue #25.
export type StatedRoomKind = 'tfsa' | 'rrsp' | 'fhsa';

export interface StatedRoom {
  personId: PersonId;
  kind: StatedRoomKind;
  amount: number;
}

export interface CesgGrant {
  id: string;
  date: IsoDate;
  beneficiaryId: PersonId;
  contributionEventId: string;
  amount: number;
  accountId: AccountId;
}

export type BudgetMode = 'envelope' | 'zero_based' | 'fifty_thirty_twenty';

export interface BudgetLine {
  categoryId: CategoryId;
  monthlyCap: number;
  rollover: boolean;
}

export interface Budget {
  mode: BudgetMode;
  lines: BudgetLine[];
  targetSavingsRate?: number;
}

export interface CraLimits {
  TFSA_ANNUAL: number;
  RRSP_ANNUAL_PCT: number;
  RRSP_ANNUAL_CAP: number;
  RESP_LIFETIME_PER_CHILD: number;
  RESP_ANNUAL_FOR_FULL_CESG: number;
  FHSA_ANNUAL: number;
  FHSA_LIFETIME: number;
  CESG_RATE: number;
  CESG_ANNUAL_PER_CHILD: number;
  CESG_LIFETIME_PER_CHILD: number;
}

export interface FixturesMeta {
  generatedAt: IsoDate;
  seed: number;
  monthsCovered: number;
  openingBalances: Record<AccountId, number>;
}

export interface Fixtures {
  household: Person[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  investments: InvestmentSnapshot[];
  contributionEvents: ContributionEvent[];
  statedRoom?: StatedRoom[];
  cesgGrants: CesgGrant[];
  budget: Budget;
  craLimits: CraLimits;
  meta: FixturesMeta;
}
