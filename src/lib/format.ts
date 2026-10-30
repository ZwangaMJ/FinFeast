import type { Currency } from '@/store/types';

const SYMBOLS: Record<Currency, string> = { ZAR: 'R', USD: '$', GBP: '£', EUR: '€' };

// Regional price data is stored in ZAR; scale for other regions (rough purchasing-power factor).
export const PRICE_FACTOR: Record<Currency, number> = { ZAR: 1, USD: 0.075, GBP: 0.06, EUR: 0.07 };

export const CURRENCY_LABELS: Record<Currency, string> = {
  ZAR: 'South Africa (R)',
  USD: 'United States ($)',
  GBP: 'United Kingdom (£)',
  EUR: 'Eurozone (€)',
};

function group(n: number, decimals: number) {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${grouped}.${dec}` : grouped;
}

export function money(n: number, currency: Currency = 'ZAR', opts: { decimals?: number; sign?: boolean } = {}) {
  const decimals = opts.decimals ?? (currency === 'ZAR' ? 0 : Math.abs(n) < 100 ? 2 : 0);
  const sign = n < 0 ? '−' : opts.sign ? '+' : '';
  return `${sign}${SYMBOLS[currency]}${group(n, decimals)}`;
}

export function symbol(currency: Currency) {
  return SYMBOLS[currency];
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
