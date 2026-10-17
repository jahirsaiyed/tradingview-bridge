import type { RuntimeError } from '../parsers/runtime.js';

/** The runtime status last read for a compiled source. */
export interface RuntimeCache {
  readonly source: string;
  readonly runtimeError: RuntimeError;
}

export interface RuntimeView {
  readonly runtimeError: RuntimeError;
  readonly runtimeChecked: boolean;
}

export interface RuntimeInput {
  readonly unchanged: boolean;
  readonly hasErrors: boolean;
  readonly runtimeError: RuntimeError;
  readonly runtimeChecked: boolean;
}

const NOT_PRESENT: RuntimeError = { present: false };

/** Keeps the cache only while it still describes the given source. */
export function cacheForSource(cache: RuntimeCache | null, source: string): RuntimeCache | null {
  return cache !== null && cache.source === source ? cache : null;
}

/** Resolves the runtime view of a compile report and the next cache. */
export function resolveRuntime(
  cache: RuntimeCache | null,
  source: string,
  report: RuntimeInput,
): { view: RuntimeView; next: RuntimeCache | null } {
  if (report.unchanged) {
    const known = cacheForSource(cache, source);
    return {
      view: { runtimeError: known?.runtimeError ?? NOT_PRESENT, runtimeChecked: false },
      next: known,
    };
  }
  const view = { runtimeError: report.runtimeError, runtimeChecked: report.runtimeChecked };
  // A failed compile leaves the previous version on the chart, so it says nothing about this source.
  return { view, next: report.hasErrors ? cache : { source, runtimeError: report.runtimeError } };
}
