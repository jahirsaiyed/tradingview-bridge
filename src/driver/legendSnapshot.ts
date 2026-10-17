import type { LegendRow } from './ownership.js';

/**
 * The legend row set at one moment (entity id plus title), used by the live smoke to prove a run leaves the
 * chart as it found it: no bridge rows left, no other row removed, no row's script replaced.
 */
export interface LegendSnapshotRow {
  readonly entityId: string;
  readonly title: string;
}

export interface LegendSnapshotDiff {
  readonly missing: readonly LegendSnapshotRow[];
  readonly extra: readonly LegendSnapshotRow[];
  readonly retitled: ReadonlyArray<{ readonly entityId: string; readonly before: string; readonly after: string }>;
}

export function takeLegendSnapshot(rows: readonly LegendRow[]): LegendSnapshotRow[] {
  return rows
    .map(({ entityId, title }) => ({ entityId, title }))
    .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}

export function diffLegendSnapshots(
  before: readonly LegendSnapshotRow[],
  after: readonly LegendSnapshotRow[],
): LegendSnapshotDiff {
  const afterById = new Map(after.map((row) => [row.entityId, row]));
  const beforeIds = new Set(before.map((row) => row.entityId));
  return {
    missing: before.filter((row) => !afterById.has(row.entityId)),
    extra: after.filter((row) => !beforeIds.has(row.entityId)),
    retitled: before
      .filter((row) => afterById.has(row.entityId) && afterById.get(row.entityId)!.title !== row.title)
      .map((row) => ({ entityId: row.entityId, before: row.title, after: afterById.get(row.entityId)!.title })),
  };
}

const show = (row: LegendSnapshotRow): string => `${row.entityId} "${row.title}"`;

/** One line naming every difference, or null when both snapshots hold the same rows. */
export function describeSnapshotDiff(diff: LegendSnapshotDiff): string | null {
  const parts = [
    diff.missing.length > 0 ? `missing: ${diff.missing.map(show).join(', ')}` : '',
    diff.extra.length > 0 ? `extra: ${diff.extra.map(show).join(', ')}` : '',
    diff.retitled.length > 0
      ? `retitled: ${diff.retitled.map((r) => `${r.entityId} "${r.before}" -> "${r.after}"`).join(', ')}`
      : '',
  ].filter((part) => part !== '');
  return parts.length > 0 ? parts.join('; ') : null;
}
