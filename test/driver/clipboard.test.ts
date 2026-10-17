import { afterEach, describe, it, expect, vi } from 'vitest';
import { withClipboardAccess, type ClipboardPage } from '../../src/driver/clipboard.js';
import { TvError } from '../../src/result.js';

interface FakeOptions {
  readonly initial?: string;
  readonly readFails?: boolean;
  readonly writeFailsFor?: string;
  readonly clearFails?: boolean;
  readonly url?: string;
}

function fakePage(options: FakeOptions = {}) {
  const log: string[] = [];
  const store = { text: options.initial ?? 'marker' };
  const clipboard = {
    readText: async () => {
      log.push('read');
      if (options.readFails) throw new Error('read denied');
      return store.text;
    },
    writeText: async (text: string) => {
      log.push(`write:${text}`);
      if (text === options.writeFailsFor) throw new Error('write denied');
      store.text = text;
    },
  };
  vi.stubGlobal('navigator', { clipboard });
  const context = {
    grantPermissions: async (permissions: string[], opts: { origin: string }) => {
      log.push(`grant:${permissions.join(',')}@${opts.origin}`);
    },
    clearPermissions: async () => {
      log.push('clear');
      if (options.clearFails) throw new Error('clear failed');
    },
  };
  const page = {
    url: () => options.url ?? 'https://www.tradingview.com/chart/abc/',
    context: () => context,
    evaluate: async <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => fn(arg),
  } as unknown as ClipboardPage;
  return { page, log, store, clipboard };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withClipboardAccess', () => {
  it('grants before fn, restores the previous text and clears permissions after success', async () => {
    const fake = fakePage({ initial: 'marker' });
    const result = await withClipboardAccess(fake.page, async () => {
      fake.log.push('fn');
      await fake.clipboard.writeText('pine source');
      return 42;
    });
    expect(result).toBe(42);
    expect(fake.store.text).toBe('marker');
    expect(fake.log).toEqual([
      'grant:clipboard-read,clipboard-write@https://www.tradingview.com',
      'read',
      'fn',
      'write:pine source',
      'write:marker',
      'clear',
    ]);
  });

  it('restores and clears when fn throws, and the original error propagates', async () => {
    const fake = fakePage({ initial: 'marker' });
    const failing = withClipboardAccess(fake.page, async () => {
      await fake.clipboard.writeText('sentinel');
      throw new TvError('PASTE_MISMATCH', 'boom');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(fake.store.text).toBe('marker');
    expect(fake.log.at(-1)).toBe('clear');
  });

  it('a failing restore does not mask the original error', async () => {
    const fake = fakePage({ initial: 'marker', writeFailsFor: 'marker' });
    const failing = withClipboardAccess(fake.page, async () => {
      throw new Error('original');
    });
    await expect(failing).rejects.toThrow('original');
    expect(fake.log).toContain('clear');
  });

  it('a failing restore or clear after success is swallowed', async () => {
    const fake = fakePage({ initial: 'marker', writeFailsFor: 'marker', clearFails: true });
    await expect(withClipboardAccess(fake.page, async () => 'done')).resolves.toBe('done');
  });

  it('does not "restore" anything when the previous clipboard was unreadable', async () => {
    const fake = fakePage({ readFails: true });
    await withClipboardAccess(fake.page, async () => {
      await fake.clipboard.writeText('pine source');
    });
    expect(fake.log).toEqual([
      'grant:clipboard-read,clipboard-write@https://www.tradingview.com',
      'read',
      'write:pine source',
      'clear',
    ]);
  });

  it('refuses a non-chart page before granting anything', async () => {
    const fake = fakePage({ url: 'https://evil.example/chart/' });
    await expect(withClipboardAccess(fake.page, async () => 1)).rejects.toMatchObject({ code: 'NO_CHART' });
    expect(fake.log).toEqual([]);
  });
});
