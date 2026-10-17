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
