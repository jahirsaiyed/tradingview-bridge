import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { readKeyStats, readTrades } from '../../src/driver/strategyReader.js';
import { createDeadline } from '../../src/driver/deadline.js';
import { SEL } from '../../src/selectors.js';
import { TvError } from '../../src/result.js';

// Only the selector counts matter: readTrades checks the trades container before touching the tabs.
function countsPage(counts: Record<string, number>): Page {
  return {
    locator: (selector: string) => ({
      count: async () => counts[selector] ?? 0,
      first: () => ({ isVisible: async () => false }),
    }),
  } as unknown as Page;
}

// The report tab is visible and clickable; evaluate() stands in for the Key stats text read.
function reportPage(read: () => string | null): Page {
  return {
    locator: () => ({ first: () => ({ isVisible: async () => true, click: async () => undefined }) }),
    evaluate: async () => read(),
  } as unknown as Page;
}

describe('readKeyStats with a deadline', () => {
  it('fails with a deadline TIMEOUT_REPORT in the render phase once the budget is used up', async () => {
    let t = 0;
    const deadline = createDeadline(1_000, () => t);
    t = 5_000; // the budget was used up before the report tab was opened
    const error = await readKeyStats(reportPage(() => null), 30_000, deadline).then(() => null, (e: unknown) => e);
    expect((error as TvError).code).toBe('TIMEOUT_REPORT');
    expect((error as TvError).details).toMatchObject({ reason: 'deadline', phase: 'report-render' });
  });

  it('fails in the stable phase when the render used the rest of the budget', async () => {
    let t = 0;
    const deadline = createDeadline(1_000, () => t);
    const read = () => {
      t = 2_000; // the render read happens just before the budget ends
      return 'Total PnL 1 USD';
    };
    const error = await readKeyStats(reportPage(read), 30_000, deadline).then(() => null, (e: unknown) => e);
    expect((error as TvError).details).toMatchObject({ reason: 'deadline', phase: 'report-stable' });
  });
});

describe('readTrades container check', () => {
  it('throws SELECTOR_MISSING when the key stats are shown but the trades container is not found', async () => {
    const error = await readTrades(countsPage({ [SEL.reportKeyFacts]: 1, [SEL.reportRoot]: 0 }), 5).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('SELECTOR_MISSING');
    expect((error as TvError).details).toEqual({ selector: SEL.reportRoot });
  });

  it('goes on to the tab check when the container exists', async () => {
    const error = await readTrades(countsPage({ [SEL.reportKeyFacts]: 1, [SEL.reportRoot]: 1 }), 5).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as TvError).code).toBe('SELECTOR_MISSING');
    expect((error as TvError).details).toEqual({ selector: SEL.tradesTab });
  });
});

// Records every click timeout; the trades table shows one closed trade row.
function clickRecordingPage(clicks: number[]): Page {
  const handle = {
    first: () => handle,
    count: async () => 1,
    isVisible: async () => true,
    click: async (options?: { timeout?: number }) => void clicks.push(options?.timeout ?? -1),
    locator: () => handle,
    allInnerTexts: async () => ['1Long Exit Oct 14, 2026, 17:00 2 USD 1 1 USD'],
  };
  return { locator: () => handle, evaluate: async () => 'Total PnL 1 USD Profit factor 1.5' } as unknown as Page;
}

describe('Strategy Tester tab clicks are bounded', () => {
  it('readTrades bounds its tab clicks by the rows timeout (at most 5 s, at least 1 ms)', async () => {
    const clicks: number[] = [];
    await readTrades(clickRecordingPage(clicks), 5, 1_200);
    expect(clicks).toEqual([1_200, 1_200]);
    const plenty: number[] = [];
    await readTrades(clickRecordingPage(plenty), 5, 30_000);
    expect(plenty).toEqual([5_000, 5_000]);
    const none: number[] = [];
    await readTrades(clickRecordingPage(none), 5, 0);
    expect(none).toEqual([1, 1]);
  });

  it('readKeyStats bounds the report tab click by the deadline', async () => {
    let t = 0;
    const deadline = createDeadline(3_000, () => t);
    const clicks: number[] = [];
    await readKeyStats(clickRecordingPage(clicks), 30_000, deadline).catch(() => undefined);
    expect(clicks[0]).toBe(3_000);
  });
});