import type { Page } from 'playwright-core';
import { readRowStatus } from './legend.js';
import { DEFAULT_SETTLE_RULE, settledStatus, type SettleRule, type StatusSample } from './statusSettle.js';
import { realSleep } from './waits.js';

const SAMPLE_INTERVAL_MS = 150;
const MAX_SAMPLES = 40; // 6 s of history, far more than the longest quiet window
/** A row missing this long was replaced (live: a first add shows a transient row for ~0.6 s). */
const MISSING_GRACE_MS = 500;

export interface RowSettleResult {
  /** True when the row stopped calculating and its status stayed unchanged for the quiet window. */
  readonly settled: boolean;
  /** The last status title read (the settled one when settled). */
  readonly title: string | null;
  /** False when the row was not on the chart (at the first read, or for longer than a short grace). */
  readonly present: boolean;
}

/**
 * Samples the legend row until it is settled (see settledStatus) or `timeoutMs` passed. Returns
 * present=false at once when the row is absent at the first read, or once it stayed absent for
 * MISSING_GRACE_MS (a briefly missing row counts as still calculating). `triggeredAt` (epoch ms of the
 * compile trigger) dates the samples for the empty-status rule; without it the trigger counts as long past.
 */
export async function waitForRowSettled(
  page: Page,
  entityId: string,
  timeoutMs: number,
  rule: SettleRule = DEFAULT_SETTLE_RULE,
  triggeredAt?: number,
): Promise<RowSettleResult> {
  const startedAt = Date.now();
  const origin = triggeredAt ?? startedAt - rule.nullMinElapsedMs;
  let samples: readonly StatusSample[] = [];
  let missingSince: number | null = null;
  for (;;) {
    const row = await readRowStatus(page, entityId);
    const now = Date.now();
    const atMs = now - startedAt;
    missingSince = row === null ? (missingSince ?? atMs) : null;
    const missingFor = missingSince === null ? 0 : atMs - missingSince;
    if (row === null && (samples.length === 0 || missingFor >= MISSING_GRACE_MS)) {
      return { settled: false, title: null, present: false };
    }
    const sample = { atMs: now - origin, loading: row?.loading ?? true, title: row?.title ?? null };
    samples = [...samples, sample].slice(-MAX_SAMPLES);
    const status = settledStatus(samples, rule);
    if (status.settled || atMs >= timeoutMs) return { settled: status.settled, title: status.title, present: row !== null };
    await realSleep(SAMPLE_INTERVAL_MS);
  }
}
