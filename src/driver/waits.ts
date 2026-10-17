export interface PollOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: PollOptions,
): Promise<T | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const interval = options.intervalMs ?? 250;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (now() >= deadline) return null;
    await sleep(interval);
  }
}

/** Settles like `promise`, or rejects with `onTimeout()` after `ms`; the timer is always cleared. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface StableOptions<T> extends PollOptions {
  /** Defaults to strict equality; an empty read (null/undefined) is never stable. */
  readonly equals?: (a: T, b: T) => boolean;
}

/**
 * Reads until two consecutive reads, `intervalMs` apart, are equal and non-empty; returns that value,
 * or null when that did not happen within `timeoutMs`.
 */
export async function pollStable<T>(read: () => Promise<T | null | undefined>, options: StableOptions<T>): Promise<T | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const equals = options.equals ?? ((a: T, b: T) => a === b);
  const deadline = now() + options.timeoutMs;
  let previous = await read();
  while (now() < deadline) {
    await sleep(options.intervalMs ?? 250);
    const next = await read();
    if (previous != null && next != null && equals(previous, next)) return next;
    previous = next;
  }
  return null;
}
