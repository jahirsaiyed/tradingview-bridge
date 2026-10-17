export interface Mutex {
  /** Runs fn after every earlier call has settled; resolves or rejects with fn's own outcome. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * A promise-chain mutex: calls run strictly one at a time, in call order. A rejected call does not
 * block or poison later calls; its error reaches only its own caller. Not re-entrant: code running
 * inside run() must never call run() on the same mutex again, or it waits on itself forever.
 */
export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(() => fn());
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
