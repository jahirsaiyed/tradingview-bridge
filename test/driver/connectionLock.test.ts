import { describe, it, expect } from 'vitest';
import { connect } from '../../src/driver/connection.js';
import { lockPath, type LockDeps } from '../../src/driver/processLock.js';

// Port 1 on loopback: nothing listens there, so connectOverCDP fails fast; no browser is involved.
const ENDPOINT = 'http://127.0.0.1:1';

function deps(files: Map<string, string>, alive: number[] = []): LockDeps {
  const fail = (code: string) => Object.assign(new Error(code), { code });
  return {
    fs: {
      writeExclusive: (path, data) => {
        if (files.has(path)) throw fail('EEXIST');
        files.set(path, data);
      },
      read: (path) => {
        const data = files.get(path);
        if (data === undefined) throw fail('ENOENT');
        return data;
      },
      remove: (path) => void files.delete(path),
    },
    isAlive: (pid) => alive.includes(pid),
    pid: 100,
    tmpdir: '/tmp',
    now: () => 1,
    env: {},
  };
}

describe('connect takes the per-port process lock', () => {
  it('fails with BRIDGE_BUSY before connecting while another live process holds the lock', async () => {
    const files = new Map([[lockPath('/tmp', '1'), JSON.stringify({ pid: 42, startedAt: 0 })]]);
    await expect(connect(ENDPOINT, deps(files, [42]))).rejects.toMatchObject({ code: 'BRIDGE_BUSY' });
  });

  it('releases a freshly taken lock when the connect fails', async () => {
    const files = new Map<string, string>();
    await expect(connect(ENDPOINT, deps(files))).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(files.size).toBe(0);
  });

  it('keeps a lock this process already held when a reconnect fails', async () => {
    const path = lockPath('/tmp', '1');
    const files = new Map([[path, JSON.stringify({ pid: 100, startedAt: 0 })]]);
    await expect(connect(ENDPOINT, deps(files, [100]))).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(files.has(path)).toBe(true);
  });
});
