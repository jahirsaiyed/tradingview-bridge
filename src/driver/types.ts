import type { CompileProblem } from '../parsers/console.js';
import type { RuntimeError } from '../parsers/runtime.js';
import type { KeyStats, Trade } from '../parsers/strategy.js';
import type { PineLogLine } from '../parsers/logs.js';
import type { LayoutMode } from './layout.js';
import type { ReportIdentity } from './reportIdentity.js';
import type { SelectorCheck } from './selftest.js';

export interface StatusInfo {
  readonly loggedIn: boolean;
  readonly chartOpen: boolean;
  readonly symbol: string | null;
  readonly interval: string | null;
  readonly layout: LayoutMode;
  readonly url: string;
  /** True when TradingView shows its full-page "Session disconnected" modal (account opened elsewhere). */
  readonly sessionDisconnected: boolean;
}

export interface CompilePayload {
  readonly compiled: boolean;
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  /**
   * True when the owned legend row stopped calculating and its status was read (a point-in-time read).
   * False when it was not read: unchanged source, no owned row, or the row did not settle within 10 s.
   */
  readonly runtimeChecked: boolean;
  /** Junk legend rows a failed compile created and the bridge removed. */
  readonly cleanedErrorRows: number;
  /** True when the source already matched the chart, so nothing was compiled again. */
  readonly unchanged: boolean;
  readonly elapsedMs: number;
}

/** The numbers part of the tv_read_strategy_stats payload. */
export interface StrategyStats {
  readonly keyStats: KeyStats;
  readonly trades?: readonly Trade[];
  readonly unparsedTradeRows?: number;
  /** Closed-trade count from the key stats (null when unknown); present when trades were requested. */
  readonly tradesTotal?: number | null;
  /** True when fewer trades were returned than min(tradeLimit, tradesTotal): only rendered rows can be read. */
  readonly tradesTruncated?: boolean;
}

/** Key stats (and trades) plus the strategy the report belongs to; see ReportIdentity. */
export type StrategyPayload = StrategyStats & ReportIdentity;

export interface StrategyArgs {
  readonly includeTrades: boolean;
  readonly tradeLimit: number;
  /** Reload the page and retry once when the report does not render (drops unsaved chart state). */
  readonly allowReload?: boolean;
}

export interface SetScriptOptions {
  /** Replace the editor even when it holds a script the bridge did not write (owner confirmed). */
  readonly overwriteExisting?: boolean;
}

export interface SelftestPayload {
  readonly layout: LayoutMode;
  readonly checks: readonly SelectorCheck[];
  readonly failures: readonly string[];
  /** Present when the overlay editor could not be opened; the selectors were still checked. */
  readonly layoutError?: string;
}

export interface DriverApi {
  status(): Promise<StatusInfo>;
  openChart(args: { symbol?: string; interval?: string }): Promise<{ url: string }>;
  setScript(source: string, options?: SetScriptOptions): Promise<{ length: number }>;
  getScript(): Promise<{ source: string }>;
  compile(): Promise<CompilePayload>;
  screenshot(): Promise<{ png: Buffer }>;
  readPineLogs(): Promise<{ lines: readonly PineLogLine[]; layoutRestored: boolean }>;
  readStrategyStats(args: StrategyArgs): Promise<StrategyPayload>;
  removeScript(): Promise<{ removed: boolean; reason?: string }>;
  selftest(): Promise<SelftestPayload>;
}
