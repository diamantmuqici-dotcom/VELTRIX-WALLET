import type { ComponentType } from 'react';
import type { RouteName } from '../state/ui';
import { AccountEditScreen, AccountScreen, AccountsScreen, CreditScreen } from './AccountsScreens';
import { ActivityScreen, TxnDetailScreen } from './ActivityScreens';
import { AnalyticsScreen } from './AnalyticsScreen';
import { CardDetailScreen, CardEditScreen, CardPresentScreen, CardsScreen } from './CardsScreens';
import { ExchangeScreen } from './ExchangeScreen';
import { HomeScreen } from './HomeScreen';
import { AssetScreen, MarketsScreen, OrdersScreen, PortfolioScreen } from './MarketsScreens';
import { NotificationsScreen, SearchScreen } from './MiscScreens';
import { RequestScreen, SendScreen } from './PaymentFlow';
import { ContactEditScreen, ContactScreen, ContactsScreen, RequestsScreen } from './PeopleScreens';
import { BillsScreen, BudgetsScreen, GoalsScreen, RecurringScreen } from './PlanningScreens';
import {
  AboutScreen,
  AppearanceScreen,
  DashboardScreen,
  DataScreen,
  FeesScreen,
  NotificationPrefsScreen,
  PreferencesScreen,
  ProfileScreen,
  SecurityScreen,
  SettingsScreen,
} from './ProfileScreens';
import { ReceiveScreen } from './ReceiveScreen';
import { WalletScreen } from './WalletScreen';

/** Route name → screen component. Every route is reachable and implemented. */
export const SCREENS: Record<RouteName, ComponentType> = {
  home: HomeScreen,
  wallet: WalletScreen,
  activity: ActivityScreen,
  markets: MarketsScreen,
  profile: ProfileScreen,
  send: SendScreen,
  request: RequestScreen,
  receive: ReceiveScreen,
  cards: CardsScreen,
  cardDetail: CardDetailScreen,
  cardEdit: CardEditScreen,
  cardPresent: CardPresentScreen,
  exchange: ExchangeScreen,
  asset: AssetScreen,
  portfolio: PortfolioScreen,
  orders: OrdersScreen,
  txn: TxnDetailScreen,
  accounts: AccountsScreen,
  account: AccountScreen,
  accountEdit: AccountEditScreen,
  credit: CreditScreen,
  contacts: ContactsScreen,
  contact: ContactScreen,
  contactEdit: ContactEditScreen,
  requests: RequestsScreen,
  analytics: AnalyticsScreen,
  notifications: NotificationsScreen,
  settings: SettingsScreen,
  appearance: AppearanceScreen,
  dashboard: DashboardScreen,
  preferences: PreferencesScreen,
  fees: FeesScreen,
  notificationPrefs: NotificationPrefsScreen,
  security: SecurityScreen,
  data: DataScreen,
  about: AboutScreen,
  goals: GoalsScreen,
  budgets: BudgetsScreen,
  recurring: RecurringScreen,
  bills: BillsScreen,
  search: SearchScreen,
};
