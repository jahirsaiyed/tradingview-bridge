// Minus sign, figure dash, en dash (escaped: source files stay pure ASCII).
const MINUS_VARIANTS = /[\u2212\u2012\u2013]/g;
const NBSP = /\u00a0/g;
const SUFFIX: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9 };

export interface Money {
  readonly value: number;
  readonly unit: string;
}

export function normalizeText(input: string): string {
  return input.replace(NBSP, ' ').replace(MINUS_VARIANTS, '-').replace(/\s+/g, ' ').trim();
}

export function parseNumber(raw: string): number | null {
  const text = normalizeText(raw).replace(/,/g, '');
  const match = /^([+-]?\d*\.?\d+)\s*([KMB])?$/i.exec(text);
  if (!match) return null;
  const multiplier = match[2] ? SUFFIX[match[2].toUpperCase()]! : 1;
  return Number((Number(match[1]) * multiplier).toPrecision(12));
}

/**
 * Parses `<number> [K|M|B] <CODE>`. The whole letter run is always the currency code: a K/M/B
 * magnitude counts only as a separate letter followed by whitespace (`1.2K USD`, `2.5 M USD`), so
 * `5 BUSD` is 5 BUSD and `10.43 KUSD` is 10.43 KUSD (a letter run is never split).
 */
export function parseMoney(raw: string): Money | null {
  const text = normalizeText(raw);
  const match = /^([+-]?[\d,]*\.?\d+)(?:\s*([KMB])\s+)?\s*([A-Z]{3,5})$/.exec(text);
  if (!match) return null;
  const value = parseNumber(`${match[1]}${match[2] ?? ''}`);
  return value === null ? null : { value, unit: match[3]! };
}

export function parsePercent(raw: string): number | null {
  const match = /^([+-]?\d*\.?\d+)\s*%$/.exec(normalizeText(raw));
  return match ? parseNumber(match[1]!) : null;
}
