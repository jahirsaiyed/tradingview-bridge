import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { waitForRowSettled } from '../../src/driver/rowSettle.js';

type Row = { loading: boolean; title: string | null } | null;
const RULE = { quietMs: 300, nullQuietMs: 600, nullMinElapsedMs: 0 };

// A fake page whose legend row follows a timeline of [fromMs, row] steps.
function timelinePage(steps: ReadonlyArray<readonly [number, Row]>): Page {
  const startedAt = Date.now();
  const evaluate = async () => {
    const elapsed = Date.now() - startedAt;
    return steps.filter(([from]) => from <= elapsed).at(-1)![1];
  };
  return { evaluate } as unknown as Page;
}

describe('waitForRowSettled on a fake page', () => {
  it('returns present=false at once when the row is not on the chart', async () => {
    const started = Date.now();
    expect(await waitForRowSettled(timelinePage([[0, null]]), 'id', 5000, RULE)).toEqual({
      settled: false,
      title: null,
      present: false,
    });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('waits until loading clears and the title is quiet', async () => {
    const page = timelinePage([
      [0, { loading: true, title: null }],
      [300, { loading: false, title: 'Opened in Pine Editor' }],
    ]);
    expect(await waitForRowSettled(page, 'id', 5000, RULE)).toEqual({
      settled: true,
      title: 'Opened in Pine Editor',
      present: true,
    });
  });

  it('reports a row replaced by another (missing past the grace) as not present', async () => {
    const page = timelinePage([
      [0, { loading: true, title: null }],
      [200, null],
    ]);
    const result = await waitForRowSettled(page, 'id', 5000, RULE);
    expect(result).toEqual({ settled: false, title: null, present: false });
  });

  it('tolerates a row that is missing for less than the grace period', async () => {
    const page = timelinePage([
      [0, { loading: true, title: null }],
      [150, null],
      [350, { loading: false, title: 'Opened in Pine Editor' }],
    ]);
    expect(await waitForRowSettled(page, 'id', 5000, RULE)).toEqual({
      settled: true,
      title: 'Opened in Pine Editor',
      present: true,
    });
  });

  it('stops at the timeout while the row keeps loading, keeping the last title', async () => {
    const page = timelinePage([[0, { loading: true, title: 'Runtime error: RE10045' }]]);
    const result = await waitForRowSettled(page, 'id', 400, RULE);
    expect(result).toEqual({ settled: false, title: 'Runtime error: RE10045', present: true });
  });
});
