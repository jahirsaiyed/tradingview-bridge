import { resolveCdpEndpoint } from '../config.js';
import { connect, type Connection } from './connection.js';
import { TvDriver } from './driver.js';

export type ConnectFn = (endpoint: string) => Promise<Connection>;

/**
 * Returns the shared driver, connecting lazily. The in-flight connect is memoized, so concurrent
 * first calls make exactly one connect() and one TvDriver (ownership state lives in that driver)
 * and all share its outcome. A failed connect clears the memo so a later call retries; a closed
 * page triggers one shared reconnect.
 */
export function createDriverProvider(endpoint?: string, connectFn: ConnectFn = connect): () => Promise<TvDriver> {
  let pending: Promise<TvDriver> | null = null;
  const start = (): Promise<TvDriver> => {
    const attempt = connectFn(endpoint ?? resolveCdpEndpoint()).then(({ page }) => new TvDriver(page));
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
    return attempt;
  };
  return async () => {
    const snapshot = pending;
    if (!snapshot) return start();
    const driver = await snapshot; // a failing in-flight attempt rejects every caller that shared it
    if (!driver.page.isClosed()) return driver;
    // The first caller to see the closed page starts the reconnect; the others join it.
    return pending === snapshot || pending === null ? start() : pending;
  };
}
