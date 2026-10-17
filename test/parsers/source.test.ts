import { describe, it, expect } from 'vitest';
import { extractScriptNames, scriptTitles, sourcesEqual } from '../../src/parsers/source.js';

const names = (title: string | null, shortTitle: string | null) => ({ title, shortTitle });

describe('extractScriptNames', () => {
  it('reads an indicator title', () => {
    expect(extractScriptNames('//@version=6\nindicator("Spike runtime")\nplot(close)')).toEqual(names('Spike runtime', null));
  });
  it('reads a strategy title followed by options', () => {
    expect(extractScriptNames('strategy("Spike strat", overlay=true, initial_capital=10000)')).toEqual(
      names('Spike strat', null),
    );
  });
  it('reads a named shorttitle next to a positional title', () => {
    expect(extractScriptNames('indicator("My Strategy", shorttitle="MyStrat", overlay=true)')).toEqual(
      names('My Strategy', 'MyStrat'),
    );
  });
  it('reads the second positional string as the short title', () => {
    expect(extractScriptNames('strategy("Long title", "LT", true)')).toEqual(names('Long title', 'LT'));
  });
  it('honors named arguments in any order and position', () => {
    expect(extractScriptNames('indicator(overlay=true, title="X")')).toEqual(names('X', null));
    expect(extractScriptNames('indicator(shorttitle="S", title="T")')).toEqual(names('T', 'S'));
    expect(extractScriptNames('indicator(overlay = true, shorttitle = "S", title = "T")')).toEqual(names('T', 'S'));
  });
  it('reads a named title argument and single quotes', () => {
    expect(extractScriptNames("indicator(title='My Ind', overlay=true)")).toEqual(names('My Ind', null));
  });
  it('unescapes escaped quotes', () => {
    expect(extractScriptNames('indicator("Say \\"hi\\"")').title).toBe('Say "hi"');
    expect(extractScriptNames("indicator('It\\'s \\\\ ok')").title).toBe("It's \\ ok");
  });
  it('ignores a declaration inside a line comment', () => {
    const source = '//@version=6\n// Port of indicator("Old Name")\nindicator("New Name")\nplot(close)';
    expect(extractScriptNames(source)).toEqual(names('New Name', null));
  });
  it('ignores a declaration inside a block comment', () => {
    const source = '/* indicator("Old", "O")\n */\nindicator("New")';
    expect(extractScriptNames(source)).toEqual(names('New', null));
  });
  it('ignores a declaration inside a string literal', () => {
    const source = 'x = "indicator(\\"x\\")"\nindicator("Real")';
    expect(extractScriptNames(source)).toEqual(names('Real', null));
  });
  it('keeps comment markers that are inside the title string', () => {
    expect(extractScriptNames('indicator("a // b /* c")').title).toBe('a // b /* c');
  });
  it('ignores strategy.* calls and reads the real declaration', () => {
    const source = 'strategy.entry("L", strategy.long)\nstrategy("Real", overlay=true)';
    expect(extractScriptNames(source)).toEqual(names('Real', null));
  });
  it('returns null for names that are not plain string literals (never guesses)', () => {
    expect(extractScriptNames('indicator("A" + "B", "S")')).toEqual(names(null, 'S'));
    expect(extractScriptNames('indicator(TITLE)')).toEqual(names(null, null));
    expect(extractScriptNames('indicator(title=name, shorttitle="S")')).toEqual(names(null, 'S'));
    expect(extractScriptNames('indicator("T", shorttitle=str.format("{0}", 1))')).toEqual(names('T', null));
  });
  it('gives a library no short title', () => {
    expect(extractScriptNames('library("MyLib", "Second")')).toEqual(names('MyLib', null));
    expect(extractScriptNames('library("MyLib", overlay=true)')).toEqual(names('MyLib', null));
  });
  it('does not let an unterminated string swallow the next line', () => {
    expect(extractScriptNames('indicator("Broken\n", shorttitle="S")')).toEqual(names(null, null));
    expect(scriptTitles('x = "oops\nindicator("Real", "R")\ny = "z"')).toEqual([]);
  });
  it('returns nulls when there is no declaration or the source is malformed', () => {
    expect(extractScriptNames('plot(close)')).toEqual(names(null, null));
    expect(extractScriptNames('indicator("unterminated')).toEqual(names(null, null));
    expect(extractScriptNames('indicator("no close paren"')).toEqual(names(null, null));
    expect(extractScriptNames('indicator')).toEqual(names(null, null));
  });
});

describe('scriptTitles', () => {
  it('lists every non-empty name, title first', () => {
    expect(scriptTitles('indicator("My Strategy", shorttitle="MyStrat")')).toEqual(['My Strategy', 'MyStrat']);
  });
  it('lists only the names that were found', () => {
    expect(scriptTitles('indicator("Only")')).toEqual(['Only']);
    expect(scriptTitles('indicator(t, shorttitle="S")')).toEqual(['S']);
  });
  it('drops empty and duplicate names', () => {
    expect(scriptTitles('indicator("", "S")')).toEqual(['S']);
    expect(scriptTitles('indicator("Same", "Same")')).toEqual(['Same']);
  });
  it('returns an empty list without a declaration', () => {
    expect(scriptTitles('plot(close)')).toEqual([]);
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
