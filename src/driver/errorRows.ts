import { normalizeText } from '../parsers/numbers.js';
import type { LegendRow } from './ownership.js';

const COMPILE_ERROR_PREFIX = 'Compilation error';

/** Entity ids of legend rows that appeared after `before` and carry a compilation-error status. */
export function findNewCompileErrorRows(before: readonly LegendRow[], after: readonly LegendRow[]): string[] {
  const knownIds = new Set(before.map((row) => row.entityId));
  return after
    .filter((row) => !knownIds.has(row.entityId))
    .filter((row) => normalizeText(row.status ?? '').startsWith(COMPILE_ERROR_PREFIX))
    .map((row) => row.entityId);
}
