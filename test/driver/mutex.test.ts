import { describe, it, expect } from 'vitest';
import { createMutex } from '../../src/driver/mutex.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createMutex', () => {
  it('returns the value of each call', async () => {
    const mutex = createMutex();
    await expect(mutex.run(async () => 42)).resolves.toBe(42);
    await expect(mutex.run(async () => 'x')).resolves.toBe('x');
  });

  it('runs calls one at a time in call order, even when they would interleave', async () => {
    const mutex = createMutex();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string, ms: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      log.push(`start ${name}`);
      await tick(ms);
      log.push(`end ${name}`);
      active -= 1;
      return name;
    };
    const results = await Promise.all([mutex.run(job('a', 30)), mutex.run(job('b', 1)), mutex.run(job('c', 10))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('does not start a queued call before the running one settles', async () => {
    const mutex = createMutex();
    let release!: () => void;
    let secondStarted = false;
    const first = mutex.run(() => new Promise<void>((resolve) => (release = resolve)));
    const second = mutex.run(async () => {
      secondStarted = true;
    });
    await tick(20);
    expect(secondStarted).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });

  it('isolates a rejected call: its error reaches only its caller and later calls still run', async () => {
    const mutex = createMutex();
    const failing = mutex.run(async () => {
      await tick(5);
      throw new Error('boom');
    });
    const next = mutex.run(async () => 'after');
    const syncThrow = mutex.run(() => {
      throw new Error('sync boom');
    });
    const last = mutex.run(async () => 'last');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('after');
    await expect(syncThrow).rejects.toThrow('sync boom');
    await expect(last).resolves.toBe('last');
  });
});
