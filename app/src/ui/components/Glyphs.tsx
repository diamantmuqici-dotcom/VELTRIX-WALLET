import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Briefcase,
  Bus,
  ChartLine,
  CircleDollarSign,
  CreditCard,
  Film,
  Gem,
  Globe,
  HeartPulse,
  House,
  Landmark,
  Plane,
  PiggyBank,
  Receipt,
  RotateCcw,
  ShoppingBag,
  SlidersHorizontal,
  Repeat,
  TrendingDown,
  TrendingUp,
  Utensils,
  Vault,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { CURRENCIES, type CurrencyCode } from '../../domain/currency';
import type { AccountIcon, AppState, Category, Txn } from '../../domain/types';
import { initialsOf } from '../../domain/validation';
import { CATEGORY_COLOR, inkFor, soft } from '../tokens';

export const ACCOUNT_ICON: Record<AccountIcon, LucideIcon> = {
  wallet: Wallet,
  landmark: Landmark,
  piggy: PiggyBank,
  card: CreditCard,
  chart: ChartLine,
  globe: Globe,
  credit: CircleDollarSign,
  vault: Vault,
  briefcase: Briefcase,
  gem: Gem,
  plane: Plane,
  home: House,
};

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  food: Utensils,
  transport: Bus,
  shopping: ShoppingBag,
  bills: Receipt,
  entertainment: Film,
  travel: Plane,
  health: HeartPulse,
  subscriptions: Repeat,
  transfers: ArrowLeftRight,
  income: Banknote,
  investing: ChartLine,
  other: SlidersHorizontal,
};

export function Avatar({ name, color, image, size = 42 }: { name: string; color: string; image?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, color: /^#[0-9a-f]{6}$/i.test(color) ? inkFor(color) : 'var(--text)', fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {image ? <img src={image} alt="" /> : initialsOf(name)}
    </span>
  );
}

export function CurrencyBadge({ code, size = 34 }: { code: CurrencyCode; size?: number }) {
  const tint = CURRENCIES[code].tint;
  return (
    <span className="cur-badge" style={{ width: size, height: size, background: soft(tint, 0x30), color: 'var(--text)', fontSize: size * 0.31 }} aria-hidden="true">
      {code}
    </span>
  );
}

export function AccountGlyph({ icon, color, size = 42 }: { icon: AccountIcon; color: string; size?: number }) {
  const Icon = ACCOUNT_ICON[icon] ?? Wallet;
  return (
    <span className="tile-ico" style={{ width: size, height: size, background: soft(color), color }} aria-hidden="true">
      <Icon size={Math.round(size * 0.48)} />
    </span>
  );
}

export function CategoryGlyph({ category, size = 42 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="tile-ico" style={{ width: size, height: size, color: CATEGORY_COLOR[category] }} aria-hidden="true">
      <Icon size={Math.round(size * 0.46)} />
    </span>
  );
}

/** Icon for a ledger entry: contact avatar for P2P, category glyph otherwise. */
export function TxnGlyph({ t, state, size = 42 }: { t: Txn; state: AppState; size?: number }) {
  if ((t.type === 'send' || t.type === 'receive') && t.counterparty) {
    const c = t.counterparty.contactId ? state.contacts.find((x) => x.id === t.counterparty?.contactId) : undefined;
    return <Avatar name={t.counterparty.name} color={c?.color ?? 'var(--surface-3)'} size={size} />;
  }
  let Icon: LucideIcon | null = null;
  if (t.type === 'transfer' || t.type === 'credit_payment') Icon = ArrowLeftRight;
  else if (t.type === 'exchange') Icon = Globe;
  else if (t.type === 'invest_buy') Icon = TrendingUp;
  else if (t.type === 'invest_sell') Icon = TrendingDown;
  else if (t.type === 'refund') Icon = RotateCcw;
  else if (t.type === 'adjustment') Icon = t.direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  if (Icon) {
    return (
      <span className="tile-ico" style={{ width: size, height: size }} aria-hidden="true">
        <Icon size={Math.round(size * 0.46)} />
      </span>
    );
  }
  return <CategoryGlyph category={t.category} size={size} />;
}
