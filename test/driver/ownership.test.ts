import { describe, it, expect } from 'vitest';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from '../../src/driver/ownership.js';

const row = (entityId: string, title: string): LegendRow => ({ entityId, title });

describe('pickOwnedEntity', () => {
  it('claims the single new row matching the script title', () => {
    const owned = pickOwnedEntity({
      before: [row('a', 'User Indicator')],
      after: [row('a', 'User Indicator'), row('b', 'Spike strat')],
      scriptTitles: ['Spike strat'],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBe('b');
  });

  it('keeps the previous owned row while it still matches', () => {
    const owned = pickOwnedEntity({
      before: [row('b', 'Spike strat')],
      after: [row('b', 'Spike strat 10 30')],
      scriptTitles: ['Spike strat'],
      previousOwned: 'b',
      action: 'updated',
    });
    expect(owned).toBe('b');
  });

  it('on update with no history claims nothing (fail safe)', () => {
    const owned = pickOwnedEntity({
      before: [row('c', 'Spike strat')],
      after: [row('c', 'Spike strat')],
      scriptTitles: ['Spike strat'],
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBeNull();
  });

  it('never claims a pre-existing user row whose title starts with the script title', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat by someone'), row('v', 'Volume')],
      after: [row('u', 'Spike strat by someone'), row('v', 'Volume')],
      scriptTitles: ['Spike strat'],
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBeNull();
  });

  it('drops a previous owned id that is no longer present after a reload', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat')],
      after: [row('u', 'Spike strat')],
      scriptTitles: ['Spike strat'],
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
      pickOwnedEntity({ before: rows, after: rows, scriptTitles: ['Spike strat'], previousOwned: 'b', action: null }),
    ).toBe('b');
  });

  it('does not claim a pre-existing same-titled row after an add', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat')],
      after: [row('u', 'Spike strat'), row('n1', 'Spike strat'), row('n2', 'Spike strat')],
      scriptTitles: ['Spike strat'],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBeNull();
  });

  it('returns null when nothing matches or no title is known', () => {
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitles: ['Spike'], previousOwned: null, action: 'added' }),
    ).toBeNull();
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitles: [], previousOwned: null, action: 'added' }),
    ).toBeNull();
  });
});

describe('pickOwnedEntity (several script names)', () => {
  it('claims a fresh row that shows the short title', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Vol')],
      after: [row('u', 'Vol'), row('n', 'MyStrat 10 30')],
      scriptTitles: ['My Strategy', 'MyStrat'],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBe('n');
  });

  it('claims a fresh row that shows the long title when both names are given', () => {
    const owned = pickOwnedEntity({
      before: [],
      after: [row('n', 'My Strategy')],
      scriptTitles: ['My Strategy', 'MyStrat'],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBe('n');
  });

  it('keeps the previous owned row when it matches any of the names', () => {
    const rows = [row('b', 'MyStrat'), row('c', 'Other')];
    expect(
      pickOwnedEntity({ before: rows, after: rows, scriptTitles: ['My Strategy', 'MyStrat'], previousOwned: 'b', action: null }),
    ).toBe('b');
  });

  it('does not keep a previous owned row whose title matches none of the names', () => {
    const owned = pickOwnedEntity({
      before: [row('b', 'Renamed script')],
      after: [row('b', 'Renamed script')],
      scriptTitles: ['Spike strat'],
      previousOwned: 'b',
      action: null,
    });
    expect(owned).toBeNull();
  });

  it('never claims a pre-existing row matching either name', () => {
    const rows = [row('u', 'MyStrat by someone'), row('v', 'My Strategy')];
    expect(
      pickOwnedEntity({ before: rows, after: rows, scriptTitles: ['My Strategy', 'MyStrat'], previousOwned: null, action: 'updated' }),
    ).toBeNull();
  });

  it('claims nothing when two fresh rows match different names', () => {
    const owned = pickOwnedEntity({
      before: [],
      after: [row('n1', 'My Strategy'), row('n2', 'MyStrat')],
      scriptTitles: ['My Strategy', 'MyStrat'],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBeNull();
  });

  it('ignores empty names instead of matching every row', () => {
    const owned = pickOwnedEntity({
      before: [],
      after: [row('n', 'Anything')],
      scriptTitles: [''],
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBeNull();
  });
});

describe('pickOwnedEntity (word-boundary match)', () => {
  const pick = (title: string, names: string[]) =>
    pickOwnedEntity({ before: [], after: [row('n', title)], scriptTitles: names, previousOwned: null, action: 'added' });

  it('does not let a short title claim a fresh row whose title merely starts with it', () => {
    expect(pick('MACD 12 26 close 9', ['My Strategy', 'M'])).toBeNull();
    expect(pick('Spike strategy', ['Spike strat'])).toBeNull();
  });

  it('matches the exact title or the title followed by a space (inputs appended)', () => {
    expect(pick('Spike strat', ['Spike strat'])).toBe('n');
    expect(pick('Spike strat 10 30', ['Spike strat'])).toBe('n');
    expect(pick('M 14 1.5', ['My Strategy', 'M'])).toBe('n');
  });

  it('does not keep a previous owned row that only shares a prefix', () => {
    const rows = [row('b', 'MACD')];
    expect(pickOwnedEntity({ before: rows, after: rows, scriptTitles: ['M'], previousOwned: 'b', action: null })).toBeNull();
  });
});
