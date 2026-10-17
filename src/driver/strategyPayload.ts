import { TvError } from '../result.js';
import type { KeyStats, Trade } from '../parsers/strategy.js';
import type { StrategyStats } from './types.js';

export interface TradeRead {
  readonly trades: readonly Trade[];
  readonly unparsed: number;
  readonly limit: number;
}

/**
 * Builds the tv_read_strategy_stats payload. tradesTotal is the closed-trade count from the key
 * stats (null when unknown). tradesTruncated is true when fewer rows than requested were returned
 * AND fewer closed trades than tradesTotal: the trade table is virtualized, so only rendered rows
 * can be read. Without a known total it is never claimed.
 */
export function strategyPayload(keyStats: KeyStats, read?: TradeRead): StrategyStats {
  if (!read) return { keyStats };
  const tradesTotal = keyStats.profitableTrades?.total ?? null;
  const closed = read.trades.filter((trade) => trade.exitTime !== null).length;
  const tradesTruncated = tradesTotal !== null && read.trades.length < read.limit && closed < tradesTotal;
  return { keyStats, trades: read.trades, unparsedTradeRows: read.unparsed, tradesTotal, tradesTruncated };
}

export type NoReloadReason = 'reload-not-allowed' | 'no-script';

const NO_RELOAD_HINT: Readonly<Record<NoReloadReason, string>> = {
  'reload-not-allowed':
    'Retry with allowReload: true to reload the page (drops unsaved chart state) and retry once.',
  'no-script': 'No reload was attempted because the bridge has not set a script in this session.',
};

/** The TIMEOUT_REPORT returned when no reload recovery is attempted, with an explanation. */
export function reportTimeoutError(original: TvError, reason: NoReloadReason): TvError {
  const message =
    'The Strategy Tester report did not render. The Strategy Tester may be empty (zero trades) or stalled. ' +
    NO_RELOAD_HINT[reason];
  return new TvError('TIMEOUT_REPORT', message, { ...original.details, reloadAttempted: false });
}
