import { describe, it, expect } from 'vitest';
import { assertOwnedReport, matchesOwnedScript } from '../../src/driver/reportIdentity.js';
import { TvError } from '../../src/result.js';

describe('matchesOwnedScript', () => {
  it('is true when the shown name equals the title or the short title', () => {
    expect(matchesOwnedScript('TV Bridge Smoke', ['TV Bridge Smoke'])).toBe(true);
    expect(matchesOwnedScript('TVBS', ['TV Bridge Smoke', 'TVBS'])).toBe(true);
  });

  it('compares for equality: an extra word or a longer short title is a mismatch', () => {
    expect(matchesOwnedScript('TV Bridge Smoke v2', ['TV Bridge Smoke'])).toBe(false);
    expect(matchesOwnedScript('TV Bridge Smoke 10 30', ['TV Bridge Smoke'])).toBe(false);
    expect(matchesOwnedScript('S Trend', ['S'])).toBe(false);
    expect(matchesOwnedScript('TV Bridge Smoker', ['TV Bridge Smoke'])).toBe(false);
  });

  it('normalizes nbsp, whitespace runs and case on both sides', () => {
    expect(matchesOwnedScript('TV\u00a0Bridge  Smoke', ['tv bridge smoke'])).toBe(true);
    expect(matchesOwnedScript('tv bridge smoke', ['TV\u00a0Bridge\tSmoke'])).toBe(true);
  });

  it('matches a name truncated with an ellipsis against a script name starting with the shown text', () => {
    expect(matchesOwnedScript('TV Bridge Sm...', ['TV Bridge Smoke'])).toBe(true);
    expect(matchesOwnedScript('TV Bridge Sm\u2026', ['TV Bridge Smoke'])).toBe(true);
    expect(matchesOwnedScript('TV Other\u2026', ['TV Bridge Smoke'])).toBe(false);
    expect(matchesOwnedScript('\u2026', ['TV Bridge Smoke'])).toBeNull();
  });

  it('is false for another strategy', () => {
    expect(matchesOwnedScript('Owner Strategy', ['TV Bridge Smoke'])).toBe(false);
  });

  it('trims the shown name before comparing', () => {
    expect(matchesOwnedScript('  TV Bridge Smoke \n', ['TV Bridge Smoke'])).toBe(true);
  });

  it('is null when either side is unknown', () => {
    expect(matchesOwnedScript(null, ['TV Bridge Smoke'])).toBeNull();
    expect(matchesOwnedScript('   ', ['TV Bridge Smoke'])).toBeNull();
    expect(matchesOwnedScript('TV Bridge Smoke', [])).toBeNull();
    expect(matchesOwnedScript('TV Bridge Smoke', [''])).toBeNull();
  });
});

describe('assertOwnedReport', () => {
  it('returns the identity when the report belongs to the owned script or is unknown', () => {
    expect(assertOwnedReport(' TV Bridge Smoke ', ['TV Bridge Smoke'])).toEqual({
      strategyName: 'TV Bridge Smoke',
      matchesOwnedScript: true,
    });
    expect(assertOwnedReport(null, ['TV Bridge Smoke'])).toEqual({ strategyName: null, matchesOwnedScript: null });
    expect(assertOwnedReport('Anything', [])).toEqual({ strategyName: 'Anything', matchesOwnedScript: null });
  });

  it('throws FOREIGN_REPORT naming the strategy that is shown', () => {
    let caught: unknown;
    try {
      assertOwnedReport('Owner Strategy', ['TV Bridge Smoke']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TvError);
    const error = caught as TvError;
    expect(error.code).toBe('FOREIGN_REPORT');
    expect(error.message).toMatch(/"Owner Strategy"/);
    expect(error.message).toMatch(/another strategy/);
    expect(error.message).toMatch(/will not return its numbers/);
    expect(error.details).toEqual({ strategyName: 'Owner Strategy', ownedScriptNames: ['TV Bridge Smoke'] });
  });
});
