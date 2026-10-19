import { describe, it, expect } from 'vitest';
import { MAX_LOG_LINES, MAX_LOG_TEXT, emptyLogsHint, parsePineLogs, settleLogsObservation } from '../../src/parsers/logs.js';

describe('parsePineLogs', () => {
  it('parses a timestamped log line', () => {
    expect(parsePineLogs(['[2026-10-17T00:00:00.000+04:00]: last bar close=1.124 fast=1.124'])).toEqual([
      { time: '2026-10-17T00:00:00.000+04:00', text: 'last bar close=1.124 fast=1.124' },
    ]);
  });
  it('skips lines that are not log lines (e.g. "No data")', () => {
    expect(parsePineLogs(['No data', ''])).toEqual([]);
  });

  it(`returns only the last ${MAX_LOG_LINES} lines`, () => {
    const raw = Array.from({ length: MAX_LOG_LINES + 25 }, (_, i) => `[2026-10-17T00:00:00Z]: n=${i}`);
    const parsed = parsePineLogs(raw);
    expect(parsed).toHaveLength(MAX_LOG_LINES);
    expect(parsed[0]!.text).toBe('n=25');
    expect(parsed.at(-1)!.text).toBe(`n=${MAX_LOG_LINES + 24}`);
  });

  it(`truncates each line text to ${MAX_LOG_TEXT} characters`, () => {
    const parsed = parsePineLogs([`[2026-10-17T00:00:00Z]: ${'x'.repeat(MAX_LOG_TEXT + 100)}`]);
    expect(parsed[0]!.text).toHaveLength(MAX_LOG_TEXT);
  });

  it('settleLogsObservation returns lines as soon as any are seen', () => {
    expect(settleLogsObservation({ lines: ['a'], empty: true }, 100, 150, 1000)).toEqual({
      result: ['a'],
      emptySince: null,
    });
  });

  it('settleLogsObservation accepts an empty state only after it persisted for the grace period', () => {
    const first = settleLogsObservation({ lines: [], empty: true }, null, 1000, 2500);
    expect(first).toEqual({ result: null, emptySince: 1000 });
    const middle = settleLogsObservation({ lines: [], empty: true }, first.emptySince, 3000, 2500);
    expect(middle).toEqual({ result: null, emptySince: 1000 });
    const settled = settleLogsObservation({ lines: [], empty: true }, middle.emptySince, 3500, 2500);
    expect(settled).toEqual({ result: [], emptySince: 1000 });
  });

  it('settleLogsObservation resets when neither lines nor an empty state are visible', () => {
    expect(settleLogsObservation({ lines: [], empty: false }, 1000, 5000, 2500)).toEqual({
      result: null,
      emptySince: null,
    });
  });

  it('uses the documented caps', () => {
    expect(MAX_LOG_LINES).toBe(500);
    expect(MAX_LOG_TEXT).toBe(2000);
  });
});

describe('emptyLogsHint', () => {
  it('explains the live-bar trap for "Waiting on logs"', () => {
    const hint = emptyLogsHint('Waiting on logs');
    expect(hint).toContain('barstate.islast');
    expect(hint).toContain('barstate.islastconfirmedhistory');
    expect(hint).toContain('log.*');
  });
  it('gives a hint for every known empty state', () => {
    for (const text of ['No data', 'Waiting on logs', 'How to work with logs']) {
      expect(emptyLogsHint(text).length).toBeGreaterThan(0);
    }
    expect(emptyLogsHint('No data')).not.toContain('barstate.islastconfirmedhistory');
    expect(emptyLogsHint(null).length).toBeGreaterThan(0);
  });
});
