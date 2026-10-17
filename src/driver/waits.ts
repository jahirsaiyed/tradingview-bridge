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
