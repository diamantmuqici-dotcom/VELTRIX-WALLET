import type { AssetDef } from '../../domain/markets';

const cache = new Map<string, Intl.NumberFormat>();

function nf(locale: string, dp: number): Intl.NumberFormat {
  const k = `${locale}|${dp}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    cache.set(k, f);
  }
  return f;
}

/** Demo price formatting: FX pairs as plain rates, everything else in USD. */
export function formatPrice(price: number, asset: AssetDef, locale: string): string {
  const s = nf(locale, asset.priceDp).format(price);
  return asset.kind === 'fx' ? s : `$${s}`;
}
