import type { CurrencyCode } from './currency';
import type { FeeSchedule } from './money';

/**
 * VELTRIX persisted state — the single source of truth.
 *
 * Every simulated balance lives on an Account and every change to a balance
 * is represented by a Txn in the ledger. `verifyLedger()` proves that each
 * account balance equals the sum of the effects of its applied ledger entries.
 */

export const SCHEMA_VERSION = 1;

export type ISODate = string; // full ISO timestamp
export type DayKey = string; // YYYY-MM-DD (local)

/* ----------------------------- Accounts ---------------------------- */

export type AccountKind = 'wallet' | 'checking' | 'savings' | 'card' | 'investment' | 'foreign' | 'credit';

export type AccountIcon =
  | 'wallet'
  | 'landmark'
  | 'piggy'
  | 'card'
  | 'chart'
  | 'globe'
  | 'credit'
  | 'vault'
  | 'briefcase'
  | 'gem'
  | 'plane'
  | 'home';

export interface CreditProfile {
  /** Displayed credit limit (minor units, > 0). */
  limit: number;
  /** Last statement balance (minor units, 0 ≤ statement ≤ limit). */
  statementBalance: number;
  /** Payment due date (YYYY-MM-DD). */
  dueDate: DayKey;
}

export interface Account {
  id: string;
  kind: AccountKind;
  name: string;
  currency: CurrencyCode;
  /** Signed balance in minor units. Credit accounts are ≤ 0 (amount owed). */
  balance: number;
  color: string;
  icon: AccountIcon;
  showOnDashboard: boolean;
  hideAmount: boolean;
  archived: boolean;
  order: number;
  createdAt: ISODate;
  credit?: CreditProfile;
}

/* ------------------------------ Cards ------------------------------ */

export type CardStyle =
  | 'obsidian'
  | 'glacier'
  | 'emerald'
  | 'royal'
  | 'aurora'
  | 'carbon'
  | 'pearl'
  | 'neon'
  | 'midnight'
  | 'custom';

export type CardPattern = 'none' | 'lines' | 'waves' | 'grid' | 'topo' | 'dots' | 'mesh';
/** Original, generic network marks — none of them reproduces a real network logo. */
export type CardNetwork = 'vx' | 'orbit' | 'nexa' | 'neutral';
export type CardKind = 'debit' | 'credit' | 'prepaid';
export type CardStatus = 'active' | 'frozen';

export interface Card {
  id: string;
  nickname: string;
  holderName: string;
  issuerName: string;
  style: CardStyle;
  customFrom: string;
  customTo: string;
  accent: string;
  pattern: CardPattern;
  network: CardNetwork;
  kind: CardKind;
  /** Account charged by simulated purchases with this card. */
  accountId: string;
  /** Four display-only digits. A full card number is never generated. */
  displayDigits: string;
  /** Fictional expiry display, e.g. "09/30". */
  expiry: string;
  showExpiry: boolean;
  /** Displayed monthly spending limit in the linked account's currency (0 = no limit). */
  spendLimit: number;
  /** Optional manual override for the displayed monthly spending. null = computed from ledger. */
  spendOverride: number | null;
  status: CardStatus;
  order: number;
  createdAt: ISODate;
}

/* ----------------------------- Contacts ---------------------------- */

export interface Contact {
  id: string;
  name: string;
  /** Fictional username without the leading @. */
  username: string;
  /** Optional e-mail-style or phone-style identifier, display only. */
  identifier: string;
  color: string;
  note: string;
  favorite: boolean;
  createdAt: ISODate;
}

/* ------------------------------ Ledger ----------------------------- */

export type TxnType =
  | 'send'
  | 'receive'
  | 'adjustment'
  | 'purchase'
  | 'refund'
  | 'transfer'
  | 'exchange'
  | 'invest_buy'
  | 'invest_sell'
  | 'fee'
  | 'credit_payment';

export type TxnSubtype =
  | 'opening'
  | 'manual'
  | 'correction'
  | 'reversal'
  | 'request'
  | 'subscription'
  | 'recurring'
  | 'goal'
  | 'bill'
  | 'starting';

export type TxnStatus = 'completed' | 'pending' | 'canceled' | 'reversed';
export type TxnDirection = 'in' | 'out' | 'internal';

export type Category =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'bills'
  | 'entertainment'
  | 'travel'
  | 'health'
  | 'subscriptions'
  | 'transfers'
  | 'income'
  | 'investing'
  | 'other';

export type RateSourceKind = 'live' | 'cached' | 'demo';

export interface TxnFx {
  from: CurrencyCode;
  to: CurrencyCode;
  /** units of `to` per 1 unit of `from`, decimal string */
  rate: string;
  sourceAmount: number;
  targetAmount: number;
  rateSource: RateSourceKind;
  rateTimestamp: ISODate;
}

export interface TxnTrade {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  realizedPnl?: number;
}

export interface Txn {
  id: string;
  type: TxnType;
  subtype?: TxnSubtype;
  title: string;
  counterparty?: { contactId?: string; name: string; handle?: string };
  /** Principal, positive minor units in `currency`. */
  amount: number;
  /** Simulated fee, minor units in `currency` (≥ 0). */
  fee: number;
  currency: CurrencyCode;
  direction: TxnDirection;
  /** Source account (out/internal) or receiving account (in). */
  accountId: string;
  /** Destination account for transfers, exchanges and credit payments. */
  toAccountId?: string;
  cardId?: string;
  note?: string;
  category: Category;
  tags: string[];
  createdAt: ISODate;
  status: TxnStatus;
  /** True while this entry's effect is included in account balances. */
  applied: boolean;
  /** True when balance tracking was switched off — recorded for history only. */
  untracked?: boolean;
  balanceBefore?: number;
  balanceAfter?: number;
  toBalanceBefore?: number;
  toBalanceAfter?: number;
  fx?: TxnFx;
  trade?: TxnTrade;
  links?: {
    reversalOf?: string;
    reversedBy?: string;
    requestId?: string;
    ruleId?: string;
    goalId?: string;
    billId?: string;
    correctionOf?: string;
  };
}

/* ----------------------------- Requests ---------------------------- */

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'paid';

export interface PaymentRequest {
  id: string;
  /** outgoing = you asked a contact for money; incoming = a contact asked you. */
  direction: 'outgoing' | 'incoming';
  contactId?: string;
  name: string;
  handle?: string;
  amount: number;
  currency: CurrencyCode;
  note: string;
  status: RequestStatus;
  accountId: string;
  createdAt: ISODate;
  resolvedAt?: ISODate;
  txnId?: string;
}

/* ------------------------------ Markets ---------------------------- */

export interface Position {
  symbol: string;
  /** decimal string */
  quantity: string;
  /** average cost per unit in USD including buy fees, decimal string */
  avgCost: string;
  openedAt: ISODate;
  updatedAt: ISODate;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  /** qty × price in USD minor units */
  notional: number;
  fee: number;
  /** cash moved (buy: notional + fee, sell: notional − fee) */
  total: number;
  realizedPnl?: number;
  createdAt: ISODate;
  txnId: string;
}

export interface MarketsState {
  watchlist: string[];
  positions: Record<string, Position>;
  orders: Order[];
  realizedPnl: number;
  demoEnabled: boolean;
}

/* -------------------------------- FX ------------------------------- */

export interface RateSnapshot {
  base: 'USD';
  /** units of currency per 1 USD */
  rates: Partial<Record<CurrencyCode, string>>;
  /** when the provider says the rates were published */
  publishedAt: ISODate;
  /** when VELTRIX fetched or bundled them */
  fetchedAt: ISODate;
  provider: string;
  kind: RateSourceKind;
}

export interface ConversionLookup {
  id: string;
  from: CurrencyCode;
  to: CurrencyCode;
  amount: number;
  result: number;
  rate: string;
  rateSource: RateSourceKind;
  createdAt: ISODate;
}

export interface FxState {
  favorites: Array<[CurrencyCode, CurrencyCode]>;
  lookups: ConversionLookup[];
  liveCache: RateSnapshot | null;
}

/* ------------------------- Planning features ----------------------- */

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  currency: CurrencyCode;
  deadline: DayKey | null;
  color: string;
  icon: AccountIcon;
  accountId: string;
  createdAt: ISODate;
}

export interface Budget {
  id: string;
  category: Category;
  limit: number;
  currency: CurrencyCode;
}

export type Frequency = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface RecurringRule {
  id: string;
  kind: 'send' | 'transfer' | 'purchase' | 'receive';
  title: string;
  amount: number;
  currency: CurrencyCode;
  fromAccountId: string;
  toAccountId?: string;
  contactId?: string;
  cardId?: string;
  category: Category;
  note: string;
  frequency: Frequency;
  nextDate: DayKey;
  active: boolean;
  isSubscription: boolean;
  createdAt: ISODate;
  lastRunAt?: ISODate;
  runs: number;
}

export interface BillReminder {
  id: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  dueDate: DayKey;
  repeat: 'none' | 'monthly' | 'yearly';
  accountId: string;
  remindDaysBefore: number;
  lastPaidAt?: ISODate;
  /** Due date for which an in-app reminder was already raised. */
  remindedFor?: DayKey;
  createdAt: ISODate;
}

export type NotificationKind = 'payment' | 'request' | 'reminder' | 'market' | 'budget' | 'goal' | 'system';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: ISODate;
  read: boolean;
  target?: { screen: string; params?: Record<string, string> };
}

/* ----------------------------- Settings ---------------------------- */

export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentName = 'mint' | 'violet' | 'azure' | 'amber' | 'rose' | 'emerald';
export type AnimationLevel = 'full' | 'reduced' | 'off';
export type NumberLocale = 'en-US' | 'de-DE' | 'fr-FR' | 'de-CH' | 'en-IN';

export type DashboardSectionId =
  | 'quickActions'
  | 'accounts'
  | 'cardPreview'
  | 'recent'
  | 'cashflow'
  | 'categories'
  | 'trend'
  | 'contacts'
  | 'currencies'
  | 'cardActivity'
  | 'watchlist'
  | 'goals'
  | 'upcoming';

export interface DashboardSection {
  id: DashboardSectionId;
  visible: boolean;
}

export interface FeeSettings {
  instantSend: FeeSchedule;
  exchange: FeeSchedule;
  trade: FeeSchedule;
}

export interface Settings {
  theme: ThemeMode;
  accent: AccentName;
  defaultCurrency: CurrencyCode;
  defaultAccountId: string;
  defaultCardId: string;
  numberLocale: NumberLocale;
  hideBalances: boolean;
  haptics: boolean;
  animation: AnimationLevel;
  notifications: { payments: boolean; requests: boolean; reminders: boolean; markets: boolean; budgets: boolean };
  /** When false, simulated activity is recorded but does not move balances. */
  trackBalances: boolean;
  fees: FeeSettings;
  dashboard: DashboardSection[];
  foreignWalletName: string;
  liveRates: boolean;
  appLock: boolean;
  widgetShowBalance: boolean;
}

export interface Profile {
  displayName: string;
  username: string;
  walletId: string;
  avatarColor: string;
  avatarImage: string | null;
  accent: string;
}

export interface Meta {
  createdAt: ISODate;
  onboarded: boolean;
  preset: PresetId;
  lastOpenedAt: ISODate;
  /** Recently processed idempotency keys (double-tap / replay protection). */
  processedOps: string[];
}

export type PresetId = 'minimal' | 'everyday' | 'premium' | 'investor' | 'sandbox';

export interface AppState {
  schemaVersion: number;
  meta: Meta;
  profile: Profile;
  settings: Settings;
  accounts: Account[];
  cards: Card[];
  contacts: Contact[];
  /** Newest last (append order). */
  transactions: Txn[];
  requests: PaymentRequest[];
  markets: MarketsState;
  fx: FxState;
  goals: SavingsGoal[];
  budgets: Budget[];
  recurring: RecurringRule[];
  bills: BillReminder[];
  notifications: AppNotification[];
}

/* ------------------------------ Results ---------------------------- */

export type OpError =
  | 'missing_recipient'
  | 'missing_amount'
  | 'invalid_amount'
  | 'insufficient_funds'
  | 'insufficient_credit'
  | 'account_not_found'
  | 'account_archived'
  | 'currency_mismatch'
  | 'same_account'
  | 'card_not_found'
  | 'card_frozen'
  | 'card_limit_exceeded'
  | 'contact_not_found'
  | 'request_not_found'
  | 'request_not_pending'
  | 'txn_not_found'
  | 'txn_not_pending'
  | 'txn_not_reversible'
  | 'missing_rate'
  | 'invalid_rate'
  | 'invalid_price'
  | 'amount_too_small'
  | 'insufficient_position'
  | 'unknown_asset'
  | 'balance_out_of_range'
  | 'invalid_input'
  | 'note_too_long'
  | 'markets_disabled'
  | 'reverse_first'
  | 'cannot_archive'
  | 'duplicate_username';

export const OP_ERROR_TEXT: Record<OpError, string> = {
  missing_recipient: 'Choose who receives this simulated payment.',
  missing_amount: 'Enter an amount.',
  invalid_amount: 'That amount is not valid.',
  insufficient_funds: 'Not enough simulated funds in this account.',
  insufficient_credit: 'Not enough simulated available credit.',
  account_not_found: 'That account no longer exists.',
  account_archived: 'That account is archived.',
  currency_mismatch: 'The currency does not match the selected account.',
  same_account: 'Choose two different accounts.',
  card_not_found: 'That card no longer exists.',
  card_frozen: 'This demo card is frozen. Unfreeze it to simulate purchases.',
  card_limit_exceeded: 'This would exceed the card’s monthly spending limit.',
  contact_not_found: 'That contact no longer exists.',
  request_not_found: 'That request no longer exists.',
  request_not_pending: 'This request has already been resolved.',
  txn_not_found: 'That ledger entry no longer exists.',
  txn_not_pending: 'Only pending simulations can be completed or canceled.',
  txn_not_reversible: 'This entry cannot be reversed.',
  missing_rate: 'No exchange rate is available for this pair.',
  invalid_rate: 'The exchange rate is not valid.',
  invalid_price: 'The demo price for this asset is not valid.',
  amount_too_small: 'Amount is too small for this asset.',
  insufficient_position: 'You do not hold enough of this asset.',
  unknown_asset: 'Unknown asset.',
  balance_out_of_range: 'That balance is outside the simulator’s range.',
  invalid_input: 'Please check the highlighted fields.',
  note_too_long: 'The note is too long.',
  markets_disabled: 'Market demo data is turned off in Settings.',
  reverse_first: 'This entry moved simulated money. Reverse it first — the reversed pair can then be removed together.',
  cannot_archive: 'This account cannot be archived right now.',
  duplicate_username: 'Another contact already uses this username.',
};

export type OpResult<T extends object = object> =
  | ({ ok: true; state: AppState; duplicate?: boolean } & T)
  | { ok: false; error: OpError; detail?: string };

/** Clock + id generator injected into every operation (deterministic in tests). */
export interface OpContext {
  now: Date;
  id: (prefix: string) => string;
}
