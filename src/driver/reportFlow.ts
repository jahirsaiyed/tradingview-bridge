import { TvError } from '../result.js';
import type { KeyStats, Trade } from '../parsers/strategy.js';
import { capMs, deadlineError, type Deadline } from './deadline.js';
import { assertOwnedReport } from './reportIdentity.js';
import { reportTimeoutError, strategyPayload } from './strategyPayload.js';
import type { StrategyPayload } from './types.js';

/** Bound for the owned strategy row to stop recalculating before the report is read. */
export const REPORT_SETTLE_TIMEOUT_MS = 15_000;
/** Bound for reading the strategy name of the shown report (its footer tab). */
export const STRATEGY_NAME_TIMEOUT_MS = 2_000;
/** Bound for the first trade rows to render in the List of Trades. */
export const TRADE_ROWS_TIMEOUT_MS = 5_000;

/** The page steps of one report read, injected so the order and the identity check are testable. */
export interface ReportSteps {
  /** Waits (bounded) until the owned strategy row stops recalculating; null when no row is owned. */
  readonly settleRow: ((timeoutMs: number) => Promise<void>) | null;
  /** Key stats once rendered and stable; its phases are capped by the deadline. */
  readonly readKeyStats: (deadline: Deadline) => Promise<KeyStats>;
  readonly readStrategyName: (timeoutMs: number) => Promise<string | null>;
  readonly readTrades: (limit: number, timeoutMs: number) => Promise<{ trades: readonly Trade[]; unparsed: number }>;
}

export interface ReportRequest {
  /** The owned script's declared names (title and short title); empty when unknown. */
  readonly names: readonly string[];
  readonly includeTrades: boolean;
  readonly tradeLimit: number;
}

function outOfTime(phase: string, deadline: Deadline): TvError {
  return deadlineError('TIMEOUT_REPORT', phase, deadline);
}

// A null name after the budget ran out may be a cut-short read: never return numbers with a guessed identity.
async function readName(steps: ReportSteps, deadline: Deadline): Promise<string | null> {
  if (deadline.expired()) throw outOfTime('strategy-name', deadline);
  const name = await steps.readStrategyName(capMs(deadline, STRATEGY_NAME_TIMEOUT_MS));
  if (name === null && deadline.expired()) throw outOfTime('strategy-name', deadline);
  return name;
}

async function readTradesInTime(steps: ReportSteps, limit: number, deadline: Deadline) {
  if (deadline.expired()) throw outOfTime('trades', deadline);
  const read = await steps.readTrades(limit, capMs(deadline, TRADE_ROWS_TIMEOUT_MS));
  // No rows at all once the budget is gone: the wait may have been cut short, so it proves nothing.
  if (read.trades.length === 0 && read.unparsed === 0 && deadline.expired()) throw outOfTime('trades', deadline);
  return read;
}

/**
 * Reads one report: settle the owned row, key stats, then the report identity BEFORE any trade is read
 * (a foreign strategy's report fails with FOREIGN_REPORT and its trades are never read), then trades.
 */
export async function collectReport(
  steps: ReportSteps,
  request: ReportRequest,
  deadline: Deadline,
): Promise<StrategyPayload> {
  if (steps.settleRow) {
    await steps.settleRow(deadline.cap(REPORT_SETTLE_TIMEOUT_MS));
    if (deadline.expired()) throw outOfTime('row-settle', deadline);
  }
  const keyStats = await steps.readKeyStats(deadline);
  const identity = assertOwnedReport(await readName(steps, deadline), request.names);
  if (!request.includeTrades) return { ...strategyPayload(keyStats), ...identity };
  const { trades, unparsed } = await readTradesInTime(steps, request.tradeLimit, deadline);
  return { ...strategyPayload(keyStats, { trades, unparsed, limit: request.tradeLimit }), ...identity };
}

export interface StatsDeps {
  readonly collect: (deadline: Deadline) => Promise<StrategyPayload>;
  /** Reload the page and re-apply the script; null when the bridge has no script to re-apply. */
  readonly recover: (() => Promise<void>) | null;
  readonly newDeadline: () => Deadline;
}

/** A TIMEOUT_REPORT that looks like a stalled Strategy Tester (not still recalculating, not out of budget). */
function isStall(error: unknown): error is TvError {
  if (!(error instanceof TvError) || error.code !== 'TIMEOUT_REPORT') return false;
  const reason = error.details?.reason;
  return reason !== 'not-settled' && reason !== 'deadline';
}

/**
 * Collects within `first`; on a stalled report and with allowReload, recovers once (reload + re-apply)
 * and collects again under a fresh deadline. Without allowReload or a script, no reload is attempted.
 */
export async function readStatsWithRecovery(
  deps: StatsDeps,
  first: Deadline,
  allowReload: boolean,
): Promise<StrategyPayload> {
  try {
    return await deps.collect(first);
  } catch (error) {
    if (!isStall(error)) throw error;
    if (!allowReload) throw reportTimeoutError(error, 'reload-not-allowed');
    if (!deps.recover) throw reportTimeoutError(error, 'no-script');
    await deps.recover();
    return deps.collect(deps.newDeadline());
  }
}
