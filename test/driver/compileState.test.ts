import { describe, it, expect } from 'vitest';
import { deriveCompiled, freshEntries, routeOutcome } from '../../src/driver/compileState.js';

const entry = (message: string) => ({ time: '1:00:00 PM', message });
const error = { line: 1, column: 1, message: 'boom' };

describe('freshEntries', () => {
  it('returns only the entries logged after the baseline', () => {
    const entries = [entry('old 1'), entry('old 2'), entry('Compiled.')];
    expect(freshEntries(entries, 2)).toEqual([entry('Compiled.')]);
  });

  it('returns nothing new when the console did not grow', () => {
    expect(freshEntries([entry('a'), entry('b')], 2)).toEqual([]);
  });

  it('treats every entry as new when the console was cleared (shorter than the baseline)', () => {
    const entries = [entry('Compiled.')];
    expect(freshEntries(entries, 5)).toEqual(entries);
  });

  it('returns everything for a zero baseline', () => {
    expect(freshEntries([entry('a')], 0)).toEqual([entry('a')]);
  });
});

// The unchanged case (formerly always true here) is now resolved by resolveCompiled; see compileMemory.test.ts.
describe('deriveCompiled', () => {
  it('is true for an error-free compile with an action', () => {
    expect(deriveCompiled({ errors: [], action: 'added' })).toBe(true);
    expect(deriveCompiled({ errors: [], action: 'updated' })).toBe(true);
  });

  it('is false when errors exist, even with an action', () => {
    expect(deriveCompiled({ errors: [error], action: 'updated' })).toBe(false);
  });

  it('is false without an action', () => {
    expect(deriveCompiled({ errors: [], action: null })).toBe(false);
  });
});

describe('routeOutcome', () => {
  const outcome = (parts: Partial<Parameters<typeof routeOutcome>[0]>) => ({
    errors: [],
    nothingToUpdate: false,
    ...parts,
  });

  it('routes "There is nothing to update." without errors to unchanged', () => {
    expect(routeOutcome(outcome({ nothingToUpdate: true }))).toBe('unchanged');
  });

  it('routes errors to failed even when "There is nothing to update." is also present', () => {
    expect(routeOutcome(outcome({ nothingToUpdate: true, errors: [error] }))).toBe('failed');
    expect(routeOutcome(outcome({ errors: [error] }))).toBe('failed');
  });

  it('routes a clean compile to applied', () => {
    expect(routeOutcome(outcome({}))).toBe('applied');
  });
});