import { normalizeText } from './numbers.js';

export interface PineLogLine {
  readonly time: string;
  readonly text: string;
}

/** Caps on what is returned to the model: the most recent lines, each text truncated. */
export const MAX_LOG_LINES = 500;
export const MAX_LOG_TEXT = 2000;

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]:\s?(.*)$/;

function parseLine(line: string): PineLogLine | null {
  const match = LOG_LINE.exec(normalizeText(line));
  return match ? { time: match[1]!, text: match[2]!.slice(0, MAX_LOG_TEXT) } : null;
}

export interface LogsObservation {
  readonly lines: readonly string[];
  /** True when the logs pane shows one of its rendered "no lines" states. */
  readonly empty: boolean;
}

export interface LogsSettlement {
  /** Lines to return ([] for a confirmed empty pane), or null to keep polling. */
  readonly result: readonly string[] | null;
  readonly emptySince: number | null;
}

/**
 * Lines win immediately. An empty state counts only after it persisted for graceMs, because a
 * logging script can show "Waiting on logs" briefly before its lines render.
 */
export function settleLogsObservation(
  observation: LogsObservation,
  emptySince: number | null,
  now: number,
  graceMs: number,
): LogsSettlement {
  if (observation.lines.length > 0) return { result: observation.lines, emptySince: null };
  if (!observation.empty) return { result: null, emptySince: null };
  const since = emptySince ?? now;
  return { result: now - since >= graceMs ? [] : null, emptySince: since };
}

const WAITING_HINT =
  'No log.* call has executed yet. A log guarded by barstate.islast does not run until the live bar closes ' +
  'while the market is open (strategies run on bar close). Log from historical bars instead, e.g. guard with ' +
  'barstate.islastconfirmedhistory (last historical bar) or log on every bar.';
const GENERIC_HINT =
  'The Pine logs pane rendered with no log lines: the script has not executed a log.* call that is visible yet.';

/** Maps the observed empty-state text of the logs pane to a hint for an empty result. */
export function emptyLogsHint(observedText: string | null): string {
  return observedText === 'Waiting on logs' ? WAITING_HINT : GENERIC_HINT;
}

export function parsePineLogs(lines: readonly string[]): PineLogLine[] {
  return lines
    .map(parseLine)
    .filter((line): line is PineLogLine => line !== null)
    .slice(-MAX_LOG_LINES);
}
