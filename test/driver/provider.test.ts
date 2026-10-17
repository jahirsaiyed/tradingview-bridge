import { describe, it, expect } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { createDriverProvider } from '../../src/driver/provider.js';
import type { Connection } from '../../src/driver/connection.js';
import { TvError } from '../../src/result.js';

interface FakePage {
  closed: boolean;
}

function fakePage(): FakePage & Page {
  const page = {
    closed: false,
    isClosed() {
      return page.closed;
    },
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
  };
  return page as unknown as FakePage & Page;
}

function fakeConnect(outcomes: Array<'ok' | 'fail'>) {
  const pages: Array<FakePage & Page> = [];
  const endpoints: string[] = [];
  const connectFn = async (endpoint: string): Promise<Connection> => {
    endpoints.push(endpoint);
    await new Promise((resolve) => setTimeout(resolve, 10));
    if ((outcomes.shift() ?? 'ok') === 'fail') throw new TvError('NOT_CONNECTED', 'no chrome');
    const page = fakePage();
    pages.push(page);
    return { browser: {} as Browser, page };
  };
  return { connectFn, pages, endpoints };
}

describe('createDriverProvider', () => {
  it('makes exactly one connect and one driver for concurrent first calls', async () => {
    const fake = fakeConnect(['ok']);
    const getDriver = createDriverProvider('http://127.0.0.1:9222', fake.connectFn);
    const drivers = await Promise.all([getDriver(), getDriver(), getDriver()]);
    expect(fake.endpoints).toEqual(['http://127.0.0.1:9222']);
    expect(new Set(drivers).size).toBe(1);
    expect(await getDriver()).toBe(drivers[0]);
  });

  it('clears the memo after a failed connect so a later call retries', async () => {
    const fake = fakeConnect(['fail', 'ok']);
    const getDriver = createDriverProvider('http://127.0.0.1:9222', fake.connectFn);
    const failures = await Promise.allSettled([getDriver(), getDriver()]);
    expect(failures.map((f) => f.status)).toEqual(['rejected', 'rejected']);
    expect(fake.endpoints).toHaveLength(1);
    const driver = await getDriver();
    expect(driver.page).toBe(fake.pages[0]);
    expect(fake.endpoints).toHaveLength(2);
  });

  it('reconnects once the page is closed', async () => {
    const fake = fakeConnect(['ok', 'ok']);
    const getDriver = createDriverProvider('http://127.0.0.1:9222', fake.connectFn);
    const first = await getDriver();
    fake.pages[0]!.closed = true;
    const [second, third] = await Promise.all([getDriver(), getDriver()]);
    expect(second).not.toBe(first);
    expect(third).toBe(second);
    expect(second.page).toBe(fake.pages[1]);
    expect(fake.endpoints).toHaveLength(2);
  });
});
