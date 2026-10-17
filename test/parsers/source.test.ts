import { describe, it, expect } from 'vitest';
import { extractScriptTitle, sourcesEqual } from '../../src/parsers/source.js';

describe('extractScriptTitle', () => {
  it('reads an indicator title', () => {
    expect(extractScriptTitle('//@version=6\nindicator("Spike runtime")\nplot(close)')).toBe('Spike runtime');
  });
  it('reads a strategy title followed by options', () => {
    expect(extractScriptTitle('strategy("Spike strat", overlay=true, initial_capital=10000)')).toBe('Spike strat');
  });
  it('reads a named title argument and single quotes', () => {
    expect(extractScriptTitle("indicator(title='My Ind', overlay=true)")).toBe('My Ind');
  });
  it('unescapes escaped quotes', () => {
    expect(extractScriptTitle('indicator("Say \\"hi\\"")')).toBe('Say "hi"');
  });
  it('returns null when there is no declaration', () => {
    expect(extractScriptTitle('plot(close)')).toBeNull();
  });
});

describe('sourcesEqual', () => {
  it('ignores CRLF line endings and trailing newlines', () => {
    expect(sourcesEqual('a\nb\n', 'a\r\nb\r\n')).toBe(true);
  });
  it('treats non-breaking spaces as spaces', () => {
    expect(sourcesEqual('a b', 'a\u00a0b')).toBe(true);
  });
  it('detects real differences', () => {
    expect(sourcesEqual('a\n    b', 'a\n  b')).toBe(false);
  });
});
