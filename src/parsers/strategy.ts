import { normalizeText, parseNumber } from './numbers.js';

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
const MONEY = /([+-]?[\d,]*\.?\d+)\s*([A-Z]{3})(?![A-Za-z])/;
const PERCENT = /([+-]?\d*\.?\d+)\s*%/;
const RATIO = /(\d+)\s*\/\s*(\d+)/;
const PLAIN = /([+-]?[\d,]*\.?\d+)/;

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
  if (!section) return null;
  const money = MONEY.exec(section);
  const value = money ? parseNumber(money[1]!) : null;
  if (!money || value === null) return null;
  const percent = PERCENT.exec(section);
  return { value, unit: money[2]!, percent: percent ? parseNumber(percent[1]!) : null };
}

function profitable(section: string | null): KeyStats['profitableTrades'] {
  if (!section) return null;
  const percent = PERCENT.exec(section);
  const ratio = RATIO.exec(section);
  const value = percent ? parseNumber(percent[1]!) : null;
  if (value === null || !ratio) return null;
  return { percent: value, wins: Number(ratio[1]), total: Number(ratio[2]) };
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
const CCY = String.raw`[A-Z]{3}`;
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

function parseTradeRow(text: string): Trade | null {
  const closed = CLOSED.exec(text);
  if (closed) return parseClosed(closed);
  const open = OPEN.exec(text);
  return open ? parseOpen(open) : null;
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
