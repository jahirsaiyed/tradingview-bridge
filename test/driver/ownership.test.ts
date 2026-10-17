import { describe, it, expect } from 'vitest';
import { pickOwnedEntity, type LegendRow } from '../../src/driver/ownership.js';

const row = (entityId: string, title: string): LegendRow => ({ entityId, title });

describe('pickOwnedEntity', () => {
  it('claims the single new row matching the script title', () => {
    const owned = pickOwnedEntity({
      before: [row('a', 'User Indicator')],
      after: [row('a', 'User Indicator'), row('b', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBe('b');
  });

  it('keeps the previous owned row while it still matches', () => {
    const owned = pickOwnedEntity({
      before: [row('b', 'Spike strat')],
      after: [row('b', 'Spike strat 10 30')],
      scriptTitle: 'Spike strat',
      previousOwned: 'b',
      action: 'updated',
    });
    expect(owned).toBe('b');
  });

  it('on update with no history claims a single matching row', () => {
    const owned = pickOwnedEntity({
      before: [row('c', 'Spike strat')],
      after: [row('c', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBe('c');
  });

  it('does not claim a pre-existing same-titled row after an add', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat')],
      after: [row('u', 'Spike strat'), row('n1', 'Spike strat'), row('n2', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBeNull();
  });

  it('returns null when nothing matches or the title is unknown', () => {
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitle: 'Spike', previousOwned: null, action: 'added' }),
    ).toBeNull();
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitle: null, previousOwned: null, action: 'added' }),
    ).toBeNull();
  });
});
