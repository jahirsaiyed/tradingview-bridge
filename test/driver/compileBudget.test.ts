import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { compileAndCollect, TRIGGER_RESERVE_MS } from '../../src/driver/compile.js';
import { createDeadline } from '../../src/driver/deadline.js';
import { TvError } from '../../src/result.js';

const OPEN = { togglePresent: true, toggleActive: true, paneHeight: 50 };

// Fake page whose clock jumps when Ctrl+Enter is pressed and moves 100 ms per console read; the console never
// shows an outcome.
function fakePage(clock: { t: number }, jumpOnPressMs: number) {
  const log: string[] = [];
  const page = {
    keyboard: {
      press: async (key: string) => {
        log.push(`key:${key}`);
        clock.t += jumpOnPressMs;
      },
    },
    evaluate: async (_fn: unknown, arg: unknown) =>
      arg !== null && typeof arg === 'object' && 'toggleSelector' in arg ? OPEN : [],
    locator: () => {
      const handle = {
        first: () => handle,
        click: async (options?: { timeout?: number }) => void log.push(`click:${options?.timeout}`),
        innerText: async () => {
          clock.t += 100;
          return '1:00:00 PM\tCompiling...';
        },
        count: async () => 1,
        isDisabled: async () => false,
      };
      return handle;
    },
  } as unknown as Page;
  return { page, log };
}

describe('compileAndCollect time budget', () => {
  it('fails before Ctrl+Enter, with nothing compiled, when less than the trigger reserve is left', async () => {
    const clock = { t: 0 };
    const deadline = createDeadline(TRIGGER_RESERVE_MS - 1, () => clock.t);
    const fake = fakePage(clock, 0);
    let triggered = false;
    const args = { previousOwned: null, scriptTitles: ['X'], deadline, onTriggered: () => void (triggered = true) };
    const error = await compileAndCollect(fake.page, args).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('TIMEOUT_COMPILE');
    expect((error as TvError).details).toMatchObject({ reason: 'deadline', phase: 'before-trigger' });
    expect(fake.log).not.toContain('key:Control+Enter');
    expect(triggered).toBe(false);
  });

  it('caps the outcome wait by the deadline and fails with a deadline TIMEOUT_COMPILE in phase outcome', async () => {
    const clock = { t: 0 };
    const deadline = createDeadline(45_000, () => clock.t);
    // 200 ms of budget are left when the outcome wait starts; two console reads use them up.
    const fake = fakePage(clock, 45_000 - 100 - 200);
    let triggered = false;
    const args = { previousOwned: null, scriptTitles: ['X'], deadline, onTriggered: () => void (triggered = true) };
    const started = Date.now();
    const error = await compileAndCollect(fake.page, args).catch((caught: unknown) => caught);
    expect(Date.now() - started).toBeLessThan(3000); // uncapped it would wait the full 15 s outcome timeout
    expect((error as TvError).code).toBe('TIMEOUT_COMPILE');
    expect((error as TvError).details).toMatchObject({ reason: 'deadline', phase: 'outcome' });
    expect(triggered).toBe(true);
  });

  it('gives the focus click a timeout derived from the remaining budget (never 0)', async () => {
    const clock = { t: 0 };
    const deadline = createDeadline(45_000, () => clock.t);
    const fake = fakePage(clock, 45_000);
    await compileAndCollect(fake.page, { previousOwned: null, scriptTitles: ['X'], deadline }).catch(() => undefined);
    expect(fake.log).toContain('click:5000');
    expect(fake.log).not.toContain('click:0');
  });
});
