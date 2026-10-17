import { describe, it, expect } from 'vitest';
import { collectReport, readStatsWithRecovery, type ReportSteps } from '../../src/driver/reportFlow.js';
import { createDeadline, type Deadline } from '../../src/driver/deadline.js';
import { TvError } from '../../src/result.js';
import type { KeyStats, Trade } from '../../src/parsers/strategy.js';

const KEY_STATS: KeyStats = {
  totalPnl: { value: 10, unit: 'USD', percent: 1 },
  maxDrawdown: null,
  profitableTrades: { percent: 50, wins: 1, total: 2 },
  profitFactor: 1.5,
};
const TRADE: Trade = {
  number: 2,
  side: 'Long',
  entryTime: 'Oct 13, 2026, 14:00',
  exitTime: 'Oct 14, 2026, 17:00',
  entryPrice: 1,
  exitPrice: 2,
  size: 1,
  netPnl: { value: 1, unit: 'USD' },
  returnPercent: 1,
};
const NAMES = ['TV Bridge Smoke'];
const REQUEST = { names: NAMES, includeTrades: true, tradeLimit: 5 };
const DEADLINE_MS = 50_000;

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

type Clock = ReturnType<typeof fakeClock>;

/** Worst-case fakes: every step uses the whole timeout it is given, then succeeds. */
function slowSteps(clock: Clock, calls: string[]): ReportSteps {
  return {
    settleRow: async (ms) => {
      calls.push('settle');
      clock.advance(ms);
    },
    readKeyStats: async (deadline: Deadline) => {
      calls.push('keyStats');
      clock.advance(deadline.cap(30_000));
      clock.advance(deadline.cap(15_000));
      return KEY_STATS;
    },
    readStrategyName: async (ms) => {
      calls.push('name');
      clock.advance(ms);
      return 'TV Bridge Smoke';
    },
    readTrades: async (_limit, ms) => {
      calls.push('trades');
      clock.advance(ms);
      return { trades: [], unparsed: 0 };
    },
  };
}

async function caught(promise: Promise<unknown>): Promise<TvError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(TvError);
  return error as TvError;
}

describe('collectReport with a shared deadline', () => {
  it('never runs past the deadline when every phase is slow, and names the phase reached', async () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const deadline = createDeadline(DEADLINE_MS, clock.now);
    const error = await caught(collectReport(slowSteps(clock, calls), REQUEST, deadline));
    expect(clock.now()).toBeLessThanOrEqual(DEADLINE_MS);
    expect(error.code).toBe('TIMEOUT_REPORT');
    expect(error.details).toMatchObject({ reason: 'deadline', phase: 'strategy-name', deadlineMs: DEADLINE_MS });
    expect(calls).toEqual(['settle', 'keyStats']);
  });

  it('stops after the row settle phase when it used the whole budget', async () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const deadline = createDeadline(10_000, clock.now);
    const error = await caught(collectReport(slowSteps(clock, calls), REQUEST, deadline));
    expect(clock.now()).toBe(10_000);
    expect(error.details).toMatchObject({ reason: 'deadline', phase: 'row-settle' });
    expect(calls).toEqual(['settle']);
  });

  it('caps each phase to the remaining time', async () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const steps: ReportSteps = {
      ...slowSteps(clock, []),
      settleRow: async (ms) => {
        seen.push(ms);
        clock.advance(46_000);
      },
      readKeyStats: async () => KEY_STATS,
      readStrategyName: async (ms) => {
        seen.push(ms);
        return 'TV Bridge Smoke';
      },
      readTrades: async (_limit, ms) => {
        seen.push(ms);
        return { trades: [TRADE], unparsed: 0 };
      },
    };
    await collectReport(steps, REQUEST, createDeadline(DEADLINE_MS, clock.now));
    expect(seen).toEqual([15_000, 2_000, 4_000]);
  });

  it('fails in the trades phase when no rows were read and the budget ran out', async () => {
    const clock = fakeClock();
    const steps: ReportSteps = { ...slowSteps(clock, []), settleRow: null, readKeyStats: async () => {
      clock.advance(DEADLINE_MS - 3_000);
      return KEY_STATS;
    } };
    const error = await caught(collectReport(steps, REQUEST, createDeadline(DEADLINE_MS, clock.now)));
    expect(error.details).toMatchObject({ reason: 'deadline', phase: 'trades' });
    expect(clock.now()).toBe(DEADLINE_MS);
  });

  it('returns the report unchanged when time is plentiful', async () => {
    const clock = fakeClock();
    const steps: ReportSteps = {
      settleRow: async () => undefined,
      readKeyStats: async () => KEY_STATS,
      readStrategyName: async () => 'TV Bridge Smoke',
      readTrades: async () => ({ trades: [TRADE], unparsed: 0 }),
    };
    const payload = await collectReport(steps, REQUEST, createDeadline(DEADLINE_MS, clock.now));
    expect(payload).toMatchObject({ keyStats: KEY_STATS, trades: [TRADE], strategyName: 'TV Bridge Smoke', matchesOwnedScript: true });
  });
});

describe('readStatsWithRecovery deadlines', () => {
  it('gives the collect after a reload recovery a fresh deadline', async () => {
    const deadlines: Deadline[] = [];
    const first = createDeadline(DEADLINE_MS);
    const fresh = createDeadline(DEADLINE_MS);
    let recovered = 0;
    const payload = await readStatsWithRecovery(
      {
        collect: async (deadline) => {
          deadlines.push(deadline);
          if (deadlines.length === 1) throw new TvError('TIMEOUT_REPORT', 'did not render', { timeoutMs: 30_000 });
          return { keyStats: KEY_STATS, strategyName: null, matchesOwnedScript: null };
        },
        recover: async () => {
          recovered += 1;
        },
        newDeadline: () => fresh,
      },
      first,
      true,
    );
    expect(payload.keyStats).toBe(KEY_STATS);
    expect(recovered).toBe(1);
    expect(deadlines).toEqual([first, fresh]);
  });

  it('never reloads on a deadline timeout, even with allowReload', async () => {
    let recovered = 0;
    const error = await caught(
      readStatsWithRecovery(
        {
          collect: async () => {
            throw new TvError('TIMEOUT_REPORT', 'budget', { reason: 'deadline', phase: 'report-render' });
          },
          recover: async () => {
            recovered += 1;
          },
          newDeadline: () => createDeadline(DEADLINE_MS),
        },
        createDeadline(DEADLINE_MS),
        true,
      ),
    );
    expect(error.details).toMatchObject({ reason: 'deadline', phase: 'report-render' });
    expect(recovered).toBe(0);
  });
});
