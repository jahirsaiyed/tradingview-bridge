import { describe, it, expect } from 'vitest';
import { strategyPayload, reportTimeoutError } from '../../src/driver/strategyPayload.js';
import type { KeyStats, Trade } from '../../src/parsers/strategy.js';
import { TvError } from '../../src/result.js';

const keyStats = (total: number | null): KeyStats => ({
  totalPnl: null,
  maxDrawdown: null,
  profitableTrades: total === null ? null : { percent: 50, wins: Math.floor(total / 2), total },
  profitFactor: null,
});

const trade = (number: number, open = false): Trade => ({
  number,
  side: 'Long',
  entryTime: 'Oct 1, 2026, 10:00',
  exitTime: open ? null : 'Oct 2, 2026, 10:00',
  entryPrice: 1,
  exitPrice: open ? null : 1.1,
  size: 1,
  netPnl: { value: 1, unit: 'USD' },
  returnPercent: open ? null : 1,
});

const trades = (n: number) => Array.from({ length: n }, (_, i) => trade(n - i));

describe('strategyPayload', () => {
  it('returns only key stats when trades were not requested', () => {
    expect(strategyPayload(keyStats(10))).toEqual({ keyStats: keyStats(10) });
  });

  it('is not truncated when every closed trade was returned', () => {
    const payload = strategyPayload(keyStats(3), { trades: trades(3), unparsed: 0, limit: 50 });
    expect(payload).toMatchObject({ tradesTotal: 3, tradesTruncated: false, unparsedTradeRows: 0 });
    expect(payload.trades).toHaveLength(3);
  });

  it('is not truncated when the limit was reached', () => {
    expect(strategyPayload(keyStats(197), { trades: trades(5), unparsed: 0, limit: 5 }).tradesTruncated).toBe(false);
  });

  it('is truncated when fewer rows were rendered than min(limit, total)', () => {
    expect(strategyPayload(keyStats(197), { trades: trades(30), unparsed: 0, limit: 50 })).toMatchObject({
      tradesTotal: 197,
      tradesTruncated: true,
    });
    expect(strategyPayload(keyStats(10), { trades: trades(9), unparsed: 1, limit: 50 }).tradesTruncated).toBe(true);
  });

  it('does not count an open trade as a closed one', () => {
    const rows = [trade(11, true), ...trades(9)];
    expect(strategyPayload(keyStats(10), { trades: rows, unparsed: 0, limit: 50 }).tradesTruncated).toBe(true);
    const all = [trade(11, true), ...trades(10)];
    expect(strategyPayload(keyStats(10), { trades: all, unparsed: 0, limit: 50 }).tradesTruncated).toBe(false);
  });

  it('reports an unknown total as null and never claims truncation then', () => {
    expect(strategyPayload(keyStats(null), { trades: trades(2), unparsed: 0, limit: 50 })).toMatchObject({
      tradesTotal: null,
      tradesTruncated: false,
    });
  });
});

describe('reportTimeoutError', () => {
  const original = new TvError('TIMEOUT_REPORT', 'did not render within 30000 ms', { timeoutMs: 30000 });

  it('explains the empty/stalled report and how to allow a reload', () => {
    const error = reportTimeoutError(original, 'reload-not-allowed');
    expect(error.code).toBe('TIMEOUT_REPORT');
    expect(error.message).toMatch(/did not render/);
    expect(error.message).toMatch(/zero trades/);
    expect(error.message).toMatch(/allowReload: true/);
    expect(error.message).toMatch(/unsaved chart state/);
    expect(error.details).toMatchObject({ timeoutMs: 30000, reloadAttempted: false });
  });

  it('says why no reload happened when the bridge has not set a script', () => {
    const error = reportTimeoutError(original, 'no-script');
    expect(error.message).toMatch(/has not set a script/);
    expect(error.details).toMatchObject({ reloadAttempted: false });
  });
});
