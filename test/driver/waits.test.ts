import { describe, it, expect } from 'vitest';
import { pollUntil, withTimeout } from '../../src/driver/waits.js';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('pollUntil', () => {
  it('returns immediately when the first probe is truthy', async () => {
    const clock = fakeClock();
    expect(await pollUntil(async () => 'ready', { timeoutMs: 1000, ...clock })).toBe('ready');
  });

  it('keeps probing until truthy', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(async () => (++calls === 3 ? 'ok' : null), {
      timeoutMs: 5000,
      intervalMs: 100,
      ...clock,
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('returns null after the timeout', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(async () => (calls++, null), {
      timeoutMs: 1000,
      intervalMs: 250,
      ...clock,
    });
    expect(result).toBeNull();
    expect(calls).toBe(5);
  });

  it('propagates probe errors', async () => {
    await expect(
      pollUntil(
        async () => {
          throw new Error('probe failed');
        },
        { timeoutMs: 100, ...fakeClock() },
      ),
    ).rejects.toThrow('probe failed');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, () => new Error('late'))).resolves.toBe(7);
  });

  it('rejects with the given error when the promise does not settle in time', async () => {
    const never = new Promise<number>(() => undefined);
    await expect(withTimeout(never, 10, () => new Error('clipboard read timed out'))).rejects.toThrow('clipboard read timed out');
  });

  it('passes through the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, () => new Error('late'))).rejects.toThrow('boom');
  });
});
