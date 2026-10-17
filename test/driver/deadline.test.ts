import { describe, it, expect } from 'vitest';
import { capMs, createDeadline, deadlineError } from '../../src/driver/deadline.js';

function fakeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createDeadline', () => {
  it('starts with the full budget and counts down with the clock', () => {
    const clock = fakeClock();
    const deadline = createDeadline(10_000, clock.now);
    expect(deadline.totalMs).toBe(10_000);
    expect(deadline.remaining()).toBe(10_000);
    clock.advance(2_500);
    expect(deadline.remaining()).toBe(7_500);
  });

  it('caps a phase to the remaining time and keeps a shorter phase as is', () => {
    const clock = fakeClock();
    const deadline = createDeadline(10_000, clock.now);
    expect(deadline.cap(3_000)).toBe(3_000);
    clock.advance(8_000);
    expect(deadline.cap(3_000)).toBe(2_000);
  });

  it('never returns a negative cap or remaining time', () => {
    const clock = fakeClock();
    const deadline = createDeadline(1_000, clock.now);
    clock.advance(5_000);
    expect(deadline.remaining()).toBe(0);
    expect(deadline.cap(3_000)).toBe(0);
  });

  it('expires exactly at the boundary, not before', () => {
    const clock = fakeClock();
    const deadline = createDeadline(1_000, clock.now);
    clock.advance(999);
    expect(deadline.expired()).toBe(false);
    clock.advance(1);
    expect(deadline.expired()).toBe(true);
  });
});

describe('deadlineError', () => {
  it('builds the typed timeout of the tool with the phase reached and extra details', () => {
    const deadline = createDeadline(45_000, () => 0);
    const error = deadlineError('TIMEOUT_COMPILE', 'row-settle', deadline, { action: 'added' });
    expect(error.code).toBe('TIMEOUT_COMPILE');
    expect(error.details).toEqual({ reason: 'deadline', phase: 'row-settle', deadlineMs: 45_000, action: 'added' });
    expect(error.message).toContain('tv_compile');
    expect(error.message).toContain('45 s');
    expect(error.message).toContain('row-settle');
  });

  it('names tv_read_strategy_stats for a report timeout', () => {
    const error = deadlineError('TIMEOUT_REPORT', 'trades', createDeadline(50_000, () => 0));
    expect(error.code).toBe('TIMEOUT_REPORT');
    expect(error.message).toContain('tv_read_strategy_stats');
    expect(error.details).toEqual({ reason: 'deadline', phase: 'trades', deadlineMs: 50_000 });
  });
});

describe('capMs', () => {
  it('is the phase cap while time is left', () => {
    const clock = fakeClock();
    const deadline = createDeadline(10_000, clock.now);
    expect(capMs(deadline, 2_000)).toBe(2_000);
    clock.advance(9_500);
    expect(capMs(deadline, 2_000)).toBe(500);
  });

  it('is never 0 (a Playwright timeout of 0 means no timeout at all)', () => {
    const clock = fakeClock();
    const deadline = createDeadline(1_000, clock.now);
    clock.advance(5_000);
    expect(capMs(deadline, 2_000)).toBe(1);
  });
});