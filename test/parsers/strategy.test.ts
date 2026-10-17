import { describe, it, expect } from 'vitest';
import { parseKeyStats, parseTradeRows } from '../../src/parsers/strategy.js';

const KEY_STATS =
  'Key stats Total PnL +391.32 USD +3.91% Max drawdown 698.36 USD 6.32% ' +
  'Profitable trades 34.01% 67/197 Profit factor 1.131 Performance Cumulative PnL';

describe('parseKeyStats', () => {
  it('parses all four key stats', () => {
    expect(parseKeyStats(KEY_STATS)).toEqual({
      totalPnl: { value: 391.32, unit: 'USD', percent: 3.91 },
      maxDrawdown: { value: 698.36, unit: 'USD', percent: 6.32 },
      profitableTrades: { percent: 34.01, wins: 67, total: 197 },
      profitFactor: 1.131,
    });
  });

  it('parses real live innerText where currency and next number touch', () => {
    const live =
      'Total PnL\n+391.32USD+3.91%\nMax drawdown\n698.36USD6.32%\n' +
      'Profitable trades\n34.01%67/197\nProfit factor\n1.131';
    expect(parseKeyStats(live)).toEqual({
      totalPnl: { value: 391.32, unit: 'USD', percent: 3.91 },
      maxDrawdown: { value: 698.36, unit: 'USD', percent: 6.32 },
      profitableTrades: { percent: 34.01, wins: 67, total: 197 },
      profitFactor: 1.131,
    });
  });

  it('handles unicode minus and splits across lines', () => {
    const text = 'Total PnL\n\u2212120.50\nUSD\n\u22121.20%\nMax drawdown 5 USD 0.1% Profit factor 0.9';
    expect(parseKeyStats(text).totalPnl).toEqual({ value: -120.5, unit: 'USD', percent: -1.2 });
  });

  it('parses 4-digit percents and comma ratios without partial matches', () => {
    const text =
      'Key stats Total PnL +12,345.67 USD +1,234.57% Max drawdown 5,000.00 USD 12.50% ' +
      'Profitable trades 34.01% 1,067/3,137 Profit factor 1.131 Performance';
    expect(parseKeyStats(text)).toEqual({
      totalPnl: { value: 12345.67, unit: 'USD', percent: 1234.57 },
      maxDrawdown: { value: 5000, unit: 'USD', percent: 12.5 },
      profitableTrades: { percent: 34.01, wins: 1067, total: 3137 },
      profitFactor: 1.131,
    });
  });

  it('parses glued live text with comma ratios and negative percents', () => {
    const live = 'Total PnL\n-1,391.32USDT-0.46%\nProfitable trades\n34.01%1,067/3,137\nProfit factor\n0.9';
    const stats = parseKeyStats(live);
    expect(stats.totalPnl).toEqual({ value: -1391.32, unit: 'USDT', percent: -0.46 });
    expect(stats.profitableTrades).toEqual({ percent: 34.01, wins: 1067, total: 3137 });
  });

  it('accepts 3-5 letter currency codes such as USDT', () => {
    const text = 'Total PnL +391.32 USDT +3.91% Max drawdown 698.36 USDT 6.32% Profit factor 1.1';
    const stats = parseKeyStats(text);
    expect(stats.totalPnl).toEqual({ value: 391.32, unit: 'USDT', percent: 3.91 });
    expect(stats.maxDrawdown).toEqual({ value: 698.36, unit: 'USDT', percent: 6.32 });
  });

  it('accepts a K/M/B magnitude suffix on money values', () => {
    const text = 'Total PnL +1.2K USD +12.00% Max drawdown 2.5 M USD 6.32% Profit factor 1.1';
    const stats = parseKeyStats(text);
    expect(stats.totalPnl).toEqual({ value: 1200, unit: 'USD', percent: 12 });
    expect(stats.maxDrawdown).toEqual({ value: 2500000, unit: 'USD', percent: 6.32 });
  });

  it('rejects a currency code that runs into a lowercase letter (USDx)', () => {
    const text = 'Total PnL +391.32 USDx +3.91% Max drawdown 698.36 USDxy 6.32% Profit factor 1.1';
    expect(parseKeyStats(text).totalPnl).toBeNull();
    expect(parseKeyStats(text).maxDrawdown).toBeNull();
  });

  it('reads a 4-5 letter code starting with K/M/B as the code, not as a magnitude', () => {
    const text = 'Total PnL 10 MANA 1% Max drawdown 5 BUSD 12.50% Profit factor 1.1';
    const stats = parseKeyStats(text);
    expect(stats.totalPnl).toEqual({ value: 10, unit: 'MANA', percent: 1 });
    expect(stats.maxDrawdown).toEqual({ value: 5, unit: 'BUSD', percent: 12.5 });
  });

  it('keeps glued USD and USDT values working next to the magnitude rule', () => {
    expect(parseKeyStats('Max drawdown 698.36USD6.32%').maxDrawdown).toEqual({ value: 698.36, unit: 'USD', percent: 6.32 });
    expect(parseKeyStats('Max drawdown 2.5 M USDT 6%').maxDrawdown).toEqual({ value: 2500000, unit: 'USDT', percent: 6 });
  });

  it('never starts a number inside a longer malformed number (left boundaries)', () => {
    const text = 'Total PnL 5 USD 1.2.3% Max drawdown 1.2.3 USD 1% Profitable trades 50.00% 2.5/10 Profit factor 1';
    const stats = parseKeyStats(text);
    expect(stats.totalPnl).toEqual({ value: 5, unit: 'USD', percent: null });
    expect(stats.maxDrawdown).toBeNull();
    expect(stats.profitableTrades).toBeNull();
  });

  it('returns nulls for missing sections', () => {
    expect(parseKeyStats('nothing here')).toEqual({
      totalPnl: null,
      maxDrawdown: null,
      profitableTrades: null,
      profitFactor: null,
    });
  });
});

const OPEN_ROW =
  '198Long Exit Entry Open Oct 15, 2026, 08:00 \u2014 1.12282 USD 9.25 K 10.38 KUSD +7.95 USD \u2014';
const CLOSED_LOSS =
  '197Long Exit Entry Oct 14, 2026, 17:00 Oct 13, 2026, 14:00 1.11291 USD 1.11802 USD 9.33 K 10.43 KUSD \u221247.67 USD \u22120.46%';
const CLOSED_LOSS_2 =
  '196Long Exit Entry Oct 9, 2026, 21:00 Oct 9, 2026, 00:00 1.11900 USD 1.12137 USD 9.32 K 10.45 KUSD \u221222.09 USD \u22120.21%';

describe('parseTradeRows', () => {
  it('parses a closed trade', () => {
    const { trades, unparsed } = parseTradeRows([CLOSED_LOSS]);
    expect(unparsed).toBe(0);
    expect(trades[0]).toEqual({
      number: 197,
      side: 'Long',
      entryTime: 'Oct 13, 2026, 14:00',
      exitTime: 'Oct 14, 2026, 17:00',
      entryPrice: 1.11802,
      exitPrice: 1.11291,
      size: 9330,
      netPnl: { value: -47.67, unit: 'USD' },
      returnPercent: -0.46,
    });
  });

  it('parses an open trade with null exit fields', () => {
    const { trades } = parseTradeRows([OPEN_ROW]);
    expect(trades[0]).toEqual({
      number: 198,
      side: 'Long',
      entryTime: 'Oct 15, 2026, 08:00',
      exitTime: null,
      entryPrice: 1.12282,
      exitPrice: null,
      size: 9250,
      netPnl: { value: 7.95, unit: 'USD' },
      returnPercent: null,
    });
  });

  it('parses USDT trade rows', () => {
    const closed = CLOSED_LOSS.replace(/USD/g, 'USDT');
    const open = OPEN_ROW.replace(/USD/g, 'USDT');
    const { trades, unparsed } = parseTradeRows([closed, open]);
    expect(unparsed).toBe(0);
    expect(trades.map((t) => t.netPnl)).toEqual([
      { value: -47.67, unit: 'USDT' },
      { value: 7.95, unit: 'USDT' },
    ]);
    expect(trades[0]!.entryPrice).toBe(1.11802);
  });

  it('parses 4-digit prices and PnL with thousands separators', () => {
    const row =
      '12Short Exit Entry Oct 14, 2026, 17:00 Oct 13, 2026, 14:00 1,234.50 USD 1,250.00 USD 2 1,250.00 USD +31.00 USD +1,240.00%';
    const { trades, unparsed } = parseTradeRows([row]);
    expect(unparsed).toBe(0);
    expect(trades[0]).toMatchObject({ exitPrice: 1234.5, entryPrice: 1250, size: 2, returnPercent: 1240 });
  });

  it('counts a row whose currency runs into a lowercase letter as unparsed', () => {
    const { trades, unparsed } = parseTradeRows([CLOSED_LOSS.replace(/USD /g, 'USDx ')]);
    expect(trades).toEqual([]);
    expect(unparsed).toBe(1);
  });

  it('ignores header and empty rows, counts unparseable trade rows', () => {
    const rows = ['Trade number Type Date and time Price Size Net PnL Return', '', OPEN_ROW, CLOSED_LOSS_2, '5Long garbage'];
    const { trades, unparsed } = parseTradeRows(rows);
    expect(trades.map((t) => t.number)).toEqual([198, 196]);
    expect(unparsed).toBe(1);
  });
});
