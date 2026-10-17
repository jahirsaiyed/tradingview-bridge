import { TvError } from '../result.js';

/** One time budget shared by every phase of a tool call. */
export interface Deadline {
  readonly totalMs: number;
  /** Milliseconds left, never negative. */
  remaining(): number;
  /** min(phaseMs, remaining()), never negative: the timeout a phase may use. */
  cap(phaseMs: number): number;
  /** True once the whole budget is used (exactly at the boundary included). */
  expired(): boolean;
}

export function createDeadline(totalMs: number, now: () => number = Date.now): Deadline {
  const endsAt = now() + totalMs;
  const remaining = (): number => Math.max(0, endsAt - now());
  return {
    totalMs,
    remaining,
    cap: (phaseMs) => Math.max(0, Math.min(phaseMs, remaining())),
    expired: () => remaining() <= 0,
  };
}

const TOOL_FOR_CODE = { TIMEOUT_COMPILE: 'tv_compile', TIMEOUT_REPORT: 'tv_read_strategy_stats' } as const;

/** The tool's typed timeout once its shared deadline is used up; details.phase names the phase reached. */
export function deadlineError(
  code: keyof typeof TOOL_FOR_CODE,
  phase: string,
  deadline: Deadline,
  details: Record<string, unknown> = {},
): TvError {
  const seconds = Math.round(deadline.totalMs / 1000);
  return new TvError(
    code,
    `${TOOL_FOR_CODE[code]} used its whole ${seconds} s time budget (phase reached: ${phase}) and stopped ` +
      'instead of running past the MCP client timeout. TradingView may be slow or still recalculating: retry shortly.',
    { reason: 'deadline', phase, deadlineMs: deadline.totalMs, ...details },
  );
}
