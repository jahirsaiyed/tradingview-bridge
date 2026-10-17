import { describe, it, expect } from 'vitest';
import { isSafeToOverwrite, recordPaste, rememberText, MAX_KNOWN_TEXTS } from '../../src/driver/scratch.js';

const NONE: ReadonlySet<string> = new Set();
const LICENSE =
  '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n' +
  '// (c) someone\n\n';

describe('isSafeToOverwrite', () => {
  it('is safe for an empty or whitespace-only editor', () => {
    expect(isSafeToOverwrite('', NONE)).toBe(true);
    expect(isSafeToOverwrite('\n\r\n   \n', NONE)).toBe(true);
  });

  it('is safe for text the bridge pasted earlier, ignoring CRLF and trailing newlines', () => {
    const pasted = '//@version=6\nindicator("Mine")\nplot(close)';
    expect(isSafeToOverwrite('//@version=6\r\nindicator("Mine")\r\nplot(close)\r\n', new Set([pasted]))).toBe(true);
  });

  it('is safe for the pristine new-indicator template, with or without the license header', () => {
    expect(isSafeToOverwrite('//@version=6\nindicator("My script")\nplot(close)\n', NONE)).toBe(true);
    expect(isSafeToOverwrite(`${LICENSE}//@version=6\nindicator("My script")\nplot(close)\n`, NONE)).toBe(true);
    expect(isSafeToOverwrite('//@version=5\n\nplot(close)\n  indicator("My script")  \n', NONE)).toBe(true);
  });

  it('is safe for the exact default strategy line or the bare strategy("My strategy") line', () => {
    const line = 'strategy("My strategy", overlay=true, margin_long=100, margin_short=100)';
    expect(isSafeToOverwrite(`${LICENSE}//@version=6\n${line}\n`, NONE)).toBe(true);
    expect(isSafeToOverwrite('//@version=6\nstrategy("My strategy")', NONE)).toBe(true);
  });

  it('accepts the real license header with the trademark and copyright signs', () => {
    const header =
      '// This Pine Script\u2122 code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n' +
      '// \u00a9 someone\n\n';
    expect(isSafeToOverwrite(`${header}//@version=6\nindicator("My script")\nplot(close)\n`, NONE)).toBe(true);
  });

  it('is NOT safe for a strategy line with other options or trailing code', () => {
    expect(isSafeToOverwrite('//@version=6\nstrategy("My strategy", overlay=true)', NONE)).toBe(false);
    expect(isSafeToOverwrite('//@version=6\nstrategy("My strategy"), x = 1', NONE)).toBe(false);
    expect(isSafeToOverwrite('strategy("My strategy", overlay=true, margin_long=100, margin_short=100) // x\nplot(1)', NONE)).toBe(false);
  });

  it('treats any comment other than the license header and //@version as user content', () => {
    const template = '//@version=6\nindicator("My script")\nplot(close)\n';
    expect(isSafeToOverwrite(`${template}// my notes: buy when RSI < 30\n`, NONE)).toBe(false);
    expect(isSafeToOverwrite(`${template}// plot(ta.ema(close, 20))\n`, NONE)).toBe(false);
    expect(isSafeToOverwrite(`// TODO\n${template}`, NONE)).toBe(false);
  });

  it('is NOT safe for a user script', () => {
    const user = '//@version=6\nindicator("RSI mine")\nplot(ta.rsi(close, 14))';
    expect(isSafeToOverwrite(user, NONE)).toBe(false);
    expect(isSafeToOverwrite(user, new Set(['//@version=6\nindicator("Other")']))).toBe(false);
  });

  it('is NOT safe for a script that merely contains the template', () => {
    const extended = '//@version=6\nindicator("My script")\nplot(close)\nplot(open)';
    expect(isSafeToOverwrite(extended, NONE)).toBe(false);
    expect(isSafeToOverwrite('//@version=6\nindicator("My script")\n', NONE)).toBe(false);
    expect(isSafeToOverwrite('//@version=6\nstrategy("My strategy")\nstrategy.entry("L", strategy.long)', NONE)).toBe(false);
    expect(isSafeToOverwrite('//@version=6\nindicator("My script", overlay=true)\nplot(close)', NONE)).toBe(false);
  });

  it('is NOT safe when only comments remain but they are not the template', () => {
    expect(isSafeToOverwrite('// my notes\nx = 1', NONE)).toBe(false);
  });
});

describe('rememberText', () => {
  it('adds the normalized text without mutating the input', () => {
    const before: readonly string[] = ['a'];
    const after = rememberText(before, 'b\r\n');
    expect(after).toEqual(['a', 'b']);
    expect(before).toEqual(['a']);
  });

  it('keeps at most MAX_KNOWN_TEXTS entries, dropping the oldest, and moves a repeat to the end', () => {
    let list: readonly string[] = [];
    for (let i = 0; i < MAX_KNOWN_TEXTS + 2; i += 1) list = rememberText(list, `t${i}`);
    expect(MAX_KNOWN_TEXTS).toBe(20);
    expect(list).toHaveLength(20);
    expect(list[0]).toBe('t2');
    list = rememberText(list, 't2');
    expect(list).toHaveLength(20);
    expect(list[19]).toBe('t2');
    expect(list[0]).toBe('t3');
  });
});

describe('recordPaste', () => {
  it('remembers the source when the read-back matches', () => {
    const result = recordPaste(['old'], 'a\nb\n', 'a\r\nb');
    expect(result).toEqual({ matched: true, known: ['old', 'a\nb'] });
  });

  it('remembers the read-back text (what the editor now holds) on a mismatch', () => {
    const before: readonly string[] = ['old'];
    const result = recordPaste(before, 'intended', 'intende');
    expect(result.matched).toBe(false);
    expect(result.known).toEqual(['old', 'intende']);
    expect(isSafeToOverwrite('intende', new Set(result.known))).toBe(true);
    expect(before).toEqual(['old']);
  });

  it('keeps the bounded-set rules', () => {
    const full = Array.from({ length: MAX_KNOWN_TEXTS }, (_, i) => `t${i}`);
    const result = recordPaste(full, 'x', 'y');
    expect(result.known).toHaveLength(MAX_KNOWN_TEXTS);
    expect(result.known[0]).toBe('t1');
    expect(result.known.at(-1)).toBe('y');
  });
});
