import { describe, it, expect } from 'vitest';
import { settledStatus, type StatusSample } from '../../src/driver/statusSettle.js';

const RULE = { quietMs: 700, nullQuietMs: 1500 };
const s = (atMs: number, loading: boolean, title: string | null): StatusSample => ({ atMs, loading, title });
const OK = 'Opened in Pine Editor';
const RE = 'Runtime error: RE10045 \u00b7 Opened in Pine Editor';

describe('settledStatus', () => {
  it('is not settled without samples or while the row is loading', () => {
    expect(settledStatus([], RULE).settled).toBe(false);
    expect(settledStatus([s(0, false, OK), s(800, true, OK)], RULE).settled).toBe(false);
  });

  it('settles once a non-empty title stayed unchanged and not loading for quietMs', () => {
    expect(settledStatus([s(0, true, OK), s(100, false, OK), s(500, false, OK)], RULE).settled).toBe(false);
    expect(settledStatus([s(0, true, OK), s(100, false, OK), s(800, false, OK)], RULE)).toEqual({
      settled: true,
      title: OK,
    });
  });

  it('restarts the quiet window after the short non-loading gap between two loading phases', () => {
    // Live trace: loading, a ~200 ms gap without loading, loading again, then done.
    const samples = [s(0, true, OK), s(1600, false, null), s(1800, true, null), s(1900, true, OK), s(2700, false, OK)];
    expect(settledStatus(samples, RULE).settled).toBe(false);
    expect(settledStatus([...samples, s(3400, false, OK)], RULE)).toEqual({ settled: true, title: OK });
  });

  it('restarts the quiet window when the title changes', () => {
    const samples = [s(0, false, null), s(400, false, null), s(450, false, RE), s(900, false, RE)];
    expect(settledStatus(samples, RULE).settled).toBe(false);
    expect(settledStatus([...samples, s(1150, false, RE)], RULE)).toEqual({ settled: true, title: RE });
  });

  it('needs the longer nullQuietMs before an empty status counts as final', () => {
    // Live trace: the runtime error badge appeared ~440 ms after loading had cleared.
    expect(settledStatus([s(0, false, null), s(1000, false, null)], RULE).settled).toBe(false);
    expect(settledStatus([s(0, false, null), s(1500, false, null)], RULE)).toEqual({ settled: true, title: null });
  });

  it('uses the default rule when none is given', () => {
    expect(settledStatus([s(0, false, OK), s(700, false, OK)])).toEqual({ settled: true, title: OK });
  });
});
