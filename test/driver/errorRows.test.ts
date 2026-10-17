import { describe, it, expect } from 'vitest';
import { findNewCompileErrorRows } from '../../src/driver/errorRows.js';
import type { LegendRow } from '../../src/driver/ownership.js';

const row = (entityId: string, title: string, status: string | null = null): LegendRow => ({
  entityId,
  title,
  status,
});
const ERR = 'Compilation error: CE10156 \u00b7 Opened in Pine Editor';

describe('findNewCompileErrorRows', () => {
  it('returns new rows whose status is a compilation error', () => {
    const before = [row('a', 'User Indicator')];
    const after = [row('a', 'User Indicator'), row('b', 'Spike test', ERR)];
    expect(findNewCompileErrorRows(before, after)).toEqual(['b']);
  });

  it('never returns a pre-existing error row', () => {
    const before = [row('a', 'Old failure', ERR)];
    const after = [row('a', 'Old failure', ERR), row('b', 'Spike test', ERR)];
    expect(findNewCompileErrorRows(before, after)).toEqual(['b']);
  });

  it('ignores new rows without a status or with another status', () => {
    const after = [row('b', 'Fine'), row('c', 'Runtime', 'Runtime error: RE10045 \u00b7 Opened in Pine Editor')];
    expect(findNewCompileErrorRows([], after)).toEqual([]);
  });

  it('handles rows without a status field (older callers)', () => {
    expect(findNewCompileErrorRows([], [{ entityId: 'x', title: 'No status field' }])).toEqual([]);
  });

  it('returns every new error row when several appeared', () => {
    const after = [row('b', 'T', ERR), row('c', 'T', ERR)];
    expect(findNewCompileErrorRows([], after)).toEqual(['b', 'c']);
  });

  it('tolerates non-breaking spaces and extra whitespace in the status', () => {
    const after = [row('b', 'T', '\u00a0 Compilation\u00a0error:  CE1 ')];
    expect(findNewCompileErrorRows([], after)).toEqual(['b']);
  });
});
