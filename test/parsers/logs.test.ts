import { describe, it, expect } from 'vitest';
import { parsePineLogs } from '../../src/parsers/logs.js';

describe('parsePineLogs', () => {
  it('parses a timestamped log line', () => {
    expect(parsePineLogs(['[2026-10-17T00:00:00.000+04:00]: last bar close=1.124 fast=1.124'])).toEqual([
      { time: '2026-10-17T00:00:00.000+04:00', text: 'last bar close=1.124 fast=1.124' },
    ]);
  });
  it('skips lines that are not log lines (e.g. "No data")', () => {
    expect(parsePineLogs(['No data', ''])).toEqual([]);
  });
});
