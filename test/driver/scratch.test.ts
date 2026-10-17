import { describe, it, expect } from 'vitest';
import { isSafeToOverwrite, rememberText, MAX_KNOWN_TEXTS } from '../../src/driver/scratch.js';

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

  it('is safe for a template that is exactly one strategy("My strategy" ...) line', () => {
    expect(isSafeToOverwrite(`${LICENSE}//@version=6\nstrategy("My strategy", overlay=true)\n`, NONE)).toBe(true);
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
