// Minus sign, figure dash, en dash (escaped: source files stay pure ASCII).
const MINUS_VARIANTS = /[\u2212\u2012\u2013]/g;
const NBSP = /\u00a0/g;
const SUFFIX: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9 };
/**
 * Only unambiguous formats: optional sign, an integer part with no separators or with proper comma
 * groups (1,234,567), an optional `.digits` decimal part and an optional K/M/B magnitude. A decimal
 * comma (12,5), European grouping (1.234,56), space grouping (1 234) or stray commas (1,2,3) never match.
 */
const STRICT_NUMBER = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([KMB])?$/i;
/** Significant digits kept after a K/M/B multiplication, to drop floating-point noise (10.43 * 1000). */
const MAGNITUDE_PRECISION = 15;

export interface Money {
  readonly value: number;
  readonly unit: string;
}

export function normalizeText(input: string): string {
  return input.replace(NBSP, ' ').replace(MINUS_VARIANTS, '-').replace(/\s+/g, ' ').trim();
}

/** The number, or null for anything that is not in an unambiguous format (never a misread value). */
export function parseNumber(raw: string): number | null {
  const match = STRICT_NUMBER.exec(normalizeText(raw));
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ''));
  if (!match[2]) return value;
  return Number((value * SUFFIX[match[2].toUpperCase()]!).toPrecision(MAGNITUDE_PRECISION));
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
