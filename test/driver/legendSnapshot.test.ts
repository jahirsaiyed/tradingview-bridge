import { describe, it, expect } from 'vitest';
import { describeSnapshotDiff, diffLegendSnapshots, takeLegendSnapshot } from '../../src/driver/legendSnapshot.js';
import type { LegendRow } from '../../src/driver/ownership.js';

const row = (entityId: string, title: string, status: string | null = null): LegendRow => ({ entityId, title, status });

describe('takeLegendSnapshot', () => {
  it('keeps entity id and title only, sorted by entity id', () => {
    expect(takeLegendSnapshot([row('b', 'Spike test', 'x'), row('a', 'Vol')])).toEqual([
      { entityId: 'a', title: 'Vol' },
      { entityId: 'b', title: 'Spike test' },
    ]);
  });
});

describe('diffLegendSnapshots', () => {
  const start = takeLegendSnapshot([row('u1', 'Vol'), row('n1', 'Spike test')]);

  it('is empty when the same rows are present in any order', () => {
    const end = takeLegendSnapshot([row('n1', 'Spike test'), row('u1', 'Vol')]);
    const diff = diffLegendSnapshots(start, end);
    expect(diff).toEqual({ missing: [], extra: [], retitled: [] });
    expect(describeSnapshotDiff(diff)).toBeNull();
  });

  it('reports a bridge row left behind and a junk compilation-error row as extra', () => {
    const end = takeLegendSnapshot([row('u1', 'Vol'), row('n1', 'Spike test'), row('x1', 'TV Bridge Smoke'), row('j1', '')]);
    const diff = diffLegendSnapshots(start, end);
    expect(diff.extra.map((r) => r.entityId)).toEqual(['j1', 'x1']);
    expect(describeSnapshotDiff(diff)).toMatch(/extra: j1 "", x1 "TV Bridge Smoke"/);
  });

  it('reports a removed non-bridge row as missing', () => {
    const diff = diffLegendSnapshots(start, takeLegendSnapshot([row('u1', 'Vol')]));
    expect(diff.missing).toEqual([{ entityId: 'n1', title: 'Spike test' }]);
    expect(describeSnapshotDiff(diff)).toMatch(/missing: n1 "Spike test"/);
  });

  it('reports a row whose script was replaced (same id, new title) as retitled', () => {
    const diff = diffLegendSnapshots(start, takeLegendSnapshot([row('u1', 'Vol'), row('n1', 'TV Bridge Smoke')]));
    expect(diff.retitled).toEqual([{ entityId: 'n1', before: 'Spike test', after: 'TV Bridge Smoke' }]);
    expect(describeSnapshotDiff(diff)).toMatch(/retitled: n1 "Spike test" -> "TV Bridge Smoke"/);
  });
});
