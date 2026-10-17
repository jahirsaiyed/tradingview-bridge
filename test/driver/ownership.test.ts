import { describe, it, expect } from 'vitest';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from '../../src/driver/ownership.js';

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

  it('on update with no history claims nothing (fail safe)', () => {
    const owned = pickOwnedEntity({
      before: [row('c', 'Spike strat')],
      after: [row('c', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBeNull();
  });

  it('never claims a pre-existing user row whose title starts with the script title', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat by someone'), row('v', 'Volume')],
      after: [row('u', 'Spike strat by someone'), row('v', 'Volume')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBeNull();
  });

  it('drops a previous owned id that is no longer present after a reload', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat')],
      after: [row('u', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: 'gone',
      action: 'updated',
    });
    expect(owned).toBeNull();
  });
});

describe('retainPresentOwned', () => {
  it('keeps the owned id while a row with that id exists', () => {
    expect(retainPresentOwned('b', [row('a', 'X'), row('b', 'Renamed')])).toBe('b');
  });

  it('returns null when the id is gone or there was none', () => {
    expect(retainPresentOwned('b', [row('a', 'X')])).toBeNull();
    expect(retainPresentOwned(null, [row('a', 'X')])).toBeNull();
  });
});

describe('pickOwnedEntity (unchanged and failed compiles)', () => {
  it('keeps a still-present, title-matching owned row when nothing new appeared', () => {
    const rows = [row('a', 'User'), row('b', 'Spike strat 10 30')];
    expect(
      pickOwnedEntity({ before: rows, after: rows, scriptTitle: 'Spike strat', previousOwned: 'b', action: null }),
    ).toBe('b');
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
