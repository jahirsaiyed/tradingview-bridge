import { normalizeText, parseMoney, parseNumber } from './numbers.js';

export interface MoneyWithPercent {
  readonly value: number;
  readonly unit: string;
  readonly percent: number | null;
}
export interface KeyStats {
  readonly totalPnl: MoneyWithPercent | null;
  readonly maxDrawdown: MoneyWithPercent | null;
  readonly profitableTrades: { readonly percent: number; readonly wins: number; readonly total: number } | null;
  readonly profitFactor: number | null;
}
export interface Trade {
  readonly number: number;
  readonly side: 'Long' | 'Short';
  readonly entryTime: string;
  readonly exitTime: string | null;
  readonly entryPrice: number;
  readonly exitPrice: number | null;
  readonly size: number;
  readonly netPnl: { readonly value: number; readonly unit: string };
  readonly returnPercent: number | null;
}

const LABELS = ['Total PnL', 'Max drawdown', 'Profitable trades', 'Profit factor'] as const;
const END_MARKERS = ['Performance'] as const;
// Left boundary (?<![\d,.]) stops a match from starting inside a longer number (e.g. "234.57" in
// "1,234.57"); 3-5 letter currency codes (USD, USDT) must not run into a further letter. A K/M/B
// magnitude is taken only as a separate letter followed by whitespace, never from inside a letter run.
const MONEY = /(?<![\d,.])[+-]?[\d,]*\.?\d+(?:\s*[KMB](?=\s))?\s*[A-Z]{3,5}(?![A-Za-z])/;
const PERCENT = /(?<![\d,.])([+-]?[\d,]*\.?\d+)\s*%/;
const RATIO = /(?<![\d,.])(\d[\d,]*)\s*\/\s*(\d[\d,]*)/;
// The whole numeric token (dots and commas included), so parseNumber rejects 1.234,56 instead of reading 1.234.
const PLAIN = /([+-]?[\d.,]*\d)/;

function sectionAfter(text: string, label: string): string | null {
  const start = text.indexOf(label);
  if (start < 0) return null;
  const from = start + label.length;
  const stops = [...LABELS.filter((l) => l !== label), ...END_MARKERS]
    .map((l) => text.indexOf(l, from))
    .filter((i) => i >= 0);
  return text.slice(from, stops.length > 0 ? Math.min(...stops) : text.length).trim();
}

function moneyWithPercent(section: string | null): MoneyWithPercent | null {
  const located = section ? MONEY.exec(section) : null;
  const money = located ? parseMoney(located[0]) : null;
  if (!section || !money) return null;
  const percent = PERCENT.exec(section);
  return { value: money.value, unit: money.unit, percent: percent ? parseNumber(percent[1]!) : null };
}

function profitable(section: string | null): KeyStats['profitableTrades'] {
  if (!section) return null;
  const percent = PERCENT.exec(section);
  const ratio = RATIO.exec(section);
  const value = percent ? parseNumber(percent[1]!) : null;
  const wins = ratio ? parseNumber(ratio[1]!) : null;
  const total = ratio ? parseNumber(ratio[2]!) : null;
  if (value === null || wins === null || total === null) return null;
  return { percent: value, wins, total };
}

export function parseKeyStats(raw: string): KeyStats {
  const text = normalizeText(raw);
  const factor = sectionAfter(text, 'Profit factor');
  const factorMatch = factor ? PLAIN.exec(factor) : null;
  return {
    totalPnl: moneyWithPercent(sectionAfter(text, 'Total PnL')),
    maxDrawdown: moneyWithPercent(sectionAfter(text, 'Max drawdown')),
    profitableTrades: profitable(sectionAfter(text, 'Profitable trades')),
    profitFactor: factorMatch ? parseNumber(factorMatch[1]!) : null,
  };
}

const DATE = String.raw`[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}`;
const NUM = String.raw`[+-]?[\d,]*\.?\d+`;
const CCY = String.raw`[A-Z]{3,5}(?![A-Za-z])`;
const SIZE = String.raw`(${NUM})(?: ([KMB]))?`;
const VALUE = String.raw`${NUM} ?[KMB]?${CCY}`;
const CLOSED = new RegExp(
  String.raw`^(\d+)(Long|Short) Exit Entry (${DATE}) (${DATE}) (${NUM}) ${CCY} (${NUM}) ${CCY} ${SIZE} ${VALUE} (${NUM}) (${CCY}) (${NUM})%$`,
);
const OPEN = new RegExp(
  String.raw`^(\d+)(Long|Short) Exit Entry Open (${DATE}) \u2014 (${NUM}) ${CCY} ${SIZE} ${VALUE} (${NUM}) (${CCY}) \u2014$`,
);
const TRADE_START = /^\d+(Long|Short)/;

function size(num: string, suffix: string | undefined): number {
  return parseNumber(`${num}${suffix ?? ''}`) ?? Number.NaN;
}

function parseClosed(m: RegExpExecArray): Trade {
  return {
    number: Number(m[1]),
    side: m[2] as Trade['side'],
    exitTime: m[3]!,
    entryTime: m[4]!,
    exitPrice: parseNumber(m[5]!),
    entryPrice: parseNumber(m[6]!)!,
    size: size(m[7]!, m[8]),
    netPnl: { value: parseNumber(m[9]!)!, unit: m[10]! },
    returnPercent: parseNumber(m[11]!),
  };
}

function parseOpen(m: RegExpExecArray): Trade {
  return {
    number: Number(m[1]),
    side: m[2] as Trade['side'],
    exitTime: null,
    entryTime: m[3]!,
    exitPrice: null,
    entryPrice: parseNumber(m[4]!)!,
    size: size(m[5]!, m[6]),
    netPnl: { value: parseNumber(m[7]!)!, unit: m[8]! },
    returnPercent: null,
  };
}

// A required number that parseNumber rejected (ambiguous format) makes the whole row unparsed, never a null field.
function hasRequiredNumbers(trade: Trade): boolean {
  return [trade.entryPrice, trade.size, trade.netPnl.value].every((value) => Number.isFinite(value));
}

function parseTradeRow(text: string): Trade | null {
  const closed = CLOSED.exec(text);
  const open = closed ? null : OPEN.exec(text);
  const trade = closed ? parseClosed(closed) : open ? parseOpen(open) : null;
  return trade !== null && hasRequiredNumbers(trade) ? trade : null;
}

export function parseTradeRows(rows: readonly string[]): { trades: Trade[]; unparsed: number } {
  const trades: Trade[] = [];
  let unparsed = 0;
  for (const raw of rows) {
    const text = normalizeText(raw);
    if (!TRADE_START.test(text)) continue;
    const trade = parseTradeRow(text);
    if (trade) trades.push(trade);
    else unparsed += 1;
  }
  return { trades, unparsed };
}
