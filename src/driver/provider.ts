import { resolveCdpEndpoint } from '../config.js';
import { connect } from './connection.js';
import { TvDriver } from './driver.js';

export function createDriverProvider(endpoint?: string): () => Promise<TvDriver> {
  let current: TvDriver | null = null;
  return async () => {
    if (current && !current.page.isClosed()) return current;
    const { page } = await connect(endpoint ?? resolveCdpEndpoint());
    current = new TvDriver(page);
    return current;
  };
}
