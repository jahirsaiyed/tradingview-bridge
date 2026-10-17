import { describe, it, expect } from 'vitest';
import { settleOwned, type OwnedSettleDeps } from '../../src/driver/ownedSettle.js';
import type { RowSettleResult } from '../../src/driver/rowSettle.js';

const SETTLED: RowSettleResult = { settled: true, title: 'Opened in Pine Editor', present: true };
const GONE: RowSettleResult = { settled: false, title: null, present: false };

function deps(picks: Array<string | null>, settle: Record<string, RowSettleResult>, alive: Set<string>): OwnedSettleDeps & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    find: async () => picks[Math.min(i++, picks.length - 1)]!,
    settle: async (id) => (calls.push(`settle:${id}`), settle[id]!),
    isPresent: async (id) => (calls.push(`present:${id}`), alive.has(id)),
  };
}

describe('settleOwned', () => {
  it('returns the settled owned row when it is still present afterwards', async () => {
    const d = deps(['real'], { real: SETTLED }, new Set(['real']));
    expect(await settleOwned(d)).toEqual({ owned: 'real', status: SETTLED });
  });

  it('returns nothing when no row can be picked', async () => {
    expect(await settleOwned(deps([null], {}, new Set()))).toEqual({ owned: null, status: null });
  });

  it('re-picks when the row vanished while settling', async () => {
    const d = deps(['temp', 'real'], { temp: GONE, real: SETTLED }, new Set(['real']));
    expect(await settleOwned(d)).toEqual({ owned: 'real', status: SETTLED });
  });

  it('re-picks when the settled row was replaced right after settling', async () => {
    // The temporary row settled, then TradingView swapped it for the real row (new entity id).
    const d = deps(['temp', 'real'], { temp: SETTLED, real: SETTLED }, new Set(['real']));
    expect(await settleOwned(d)).toEqual({ owned: 'real', status: SETTLED });
    expect(d.calls).toEqual(['settle:temp', 'present:temp', 'settle:real', 'present:real']);
  });

  it('gives up after the pick budget', async () => {
    const d = deps(['a', 'b', 'c', 'd'], { a: GONE, b: GONE, c: GONE, d: SETTLED }, new Set(['d']));
    expect(await settleOwned(d)).toEqual({ owned: null, status: null });
  });
});
