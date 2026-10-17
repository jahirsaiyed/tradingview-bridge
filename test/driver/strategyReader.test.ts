import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { readTrades } from '../../src/driver/strategyReader.js';
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
