import { normalizeText } from '../parsers/numbers.js';
import type { LegendRow } from './ownership.js';

const COMPILE_ERROR_PREFIX = 'Compilation error';

/** True when a legend row status title reports a compilation error (e.g. "Compilation error: CE10156 ..."). */
export function isCompileErrorStatus(status: string | null | undefined): boolean {
  return normalizeText(status ?? '').startsWith(COMPILE_ERROR_PREFIX);
}

/** Entity ids of legend rows that appeared after `before` and carry a compilation-error status. */
export function findNewCompileErrorRows(before: readonly LegendRow[], after: readonly LegendRow[]): string[] {
  const knownIds = new Set(before.map((row) => row.entityId));
  return after
    .filter((row) => !knownIds.has(row.entityId))
    .filter((row) => isCompileErrorStatus(row.status))
    .map((row) => row.entityId);
}
