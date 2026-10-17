/** One read of the owned legend row: TradingView sets data-status="loading" while the script calculates. */
export interface StatusSample {
  readonly atMs: number;
  readonly loading: boolean;
  /** The row's status badge title (e.g. "Runtime error: RE10045 ..."), null when the badge is absent. */
  readonly title: string | null;
}

export interface SettleRule {
  /** How long a non-empty status must stay unchanged, without loading, to be final. */
  readonly quietMs: number;
  /** The same for an empty status: a runtime error badge was seen ~440 ms after loading cleared. */
  readonly nullQuietMs: number;
  /**
   * Without a loading sample, an empty status is final only once atMs reached this (atMs counts from the
   * compile trigger): the read may otherwise have started before the row began calculating.
   */
  readonly nullMinElapsedMs: number;
}

/** Live traces (2026-10-17): loading phases are separated by a ~200 ms gap, so 700 ms is safely longer. */
export const DEFAULT_SETTLE_RULE: SettleRule = { quietMs: 700, nullQuietMs: 1500, nullMinElapsedMs: 2500 };

export interface SettledStatus {
  readonly settled: boolean;
  readonly title: string | null;
}

/**
 * Settled when the trailing samples show the row not loading with the same status title for at
 * least quietMs (nullQuietMs when the title is empty). Any loading sample or title change restarts it.
 * An empty title also needs a loading sample among `samples` or atMs >= nullMinElapsedMs.
 */
export function settledStatus(samples: readonly StatusSample[], rule: SettleRule = DEFAULT_SETTLE_RULE): SettledStatus {
  const last = samples[samples.length - 1];
  if (!last || last.loading) return { settled: false, title: last?.title ?? null };
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const sample = samples[i]!;
    if (sample.loading || sample.title !== last.title) break;
    first = sample;
  }
  const needed = last.title === null ? rule.nullQuietMs : rule.quietMs;
  const quiet = last.atMs - first.atMs >= needed;
  const nullFinal = last.title !== null || samples.some((sample) => sample.loading) || last.atMs >= rule.nullMinElapsedMs;
  return { settled: quiet && nullFinal, title: last.title };
}
