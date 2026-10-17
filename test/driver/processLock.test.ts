import { describe, it, expect } from 'vitest';
import {
  acquireBridgeLock,
  installReleaseOnExit,
  isProcessAlive,
  lockPath,
  nodeLockDeps,
  portOfEndpoint,
  type LockDeps,
} from '../../src/driver/processLock.js';
import { TvError } from '../../src/result.js';

function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fail = (code: string) => Object.assign(new Error(code), { code });
  return {
    files,
    writeExclusive: (path: string, data: string) => {
      if (files.has(path)) throw fail('EEXIST');
      files.set(path, data);
    },
    read: (path: string) => {
      const data = files.get(path);
      if (data === undefined) throw fail('ENOENT');
      return data;
    },
    remove: (path: string) => {
      if (!files.delete(path)) throw fail('ENOENT');
    },
  };
}

function deps(overrides: Partial<LockDeps> & { alive?: number[] } = {}): LockDeps & { fs: ReturnType<typeof fakeFs> } {
  const alive = new Set(overrides.alive ?? []);
  return {
    fs: fakeFs(),
    isAlive: (pid) => alive.has(pid),
    pid: 100,
    tmpdir: '/tmp',
    now: () => 5,
    env: {},
    ...overrides,
  } as LockDeps & { fs: ReturnType<typeof fakeFs> };
}

const PATH = lockPath('/tmp', '9222');
const holder = (pid: number) => JSON.stringify({ pid, startedAt: 1 });

describe('portOfEndpoint / lockPath', () => {
  it('derives the port (default by scheme) and a per-port file in the temp dir', () => {
    expect(portOfEndpoint('http://127.0.0.1:9222')).toBe('9222');
    expect(portOfEndpoint('http://localhost')).toBe('80');
    expect(portOfEndpoint('https://localhost')).toBe('443');
    expect(PATH).toMatch(/tradingview-bridge-cdp-9222\.lock$/);
  });
});

describe('acquireBridgeLock', () => {
  it('creates the lock file with this pid when none exists', () => {
    const d = deps();
    const lock = acquireBridgeLock('9222', d);
    expect(lock?.fresh).toBe(true);
    expect(JSON.parse(d.fs.files.get(PATH)!)).toEqual({ pid: 100, startedAt: 5 });
  });

  it('takes over a lock whose process is dead', () => {
    const d = deps({ fs: fakeFs({ [PATH]: holder(42) }) });
    expect(acquireBridgeLock('9222', d)?.fresh).toBe(true);
    expect(JSON.parse(d.fs.files.get(PATH)!).pid).toBe(100);
  });

  it('takes over a corrupt lock file', () => {
    for (const junk of ['not json', '{}', JSON.stringify({ pid: -3 })]) {
      const d = deps({ fs: fakeFs({ [PATH]: junk }) });
      expect(acquireBridgeLock('9222', d)?.fresh).toBe(true);
    }
  });

  it('refuses with BRIDGE_BUSY naming the other process while it is alive', () => {
    const d = deps({ fs: fakeFs({ [PATH]: holder(42) }), alive: [42] });
    const error = (() => {
      try {
        acquireBridgeLock('9222', d);
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('BRIDGE_BUSY');
    expect((error as TvError).message).toMatch(/process 42/);
    expect((error as TvError).message).toMatch(/TV_ALLOW_SHARED_CHROME=1/);
    expect((error as TvError).details).toMatchObject({ pid: 42, lockFile: PATH });
    expect(JSON.parse(d.fs.files.get(PATH)!).pid).toBe(42);
  });

  it('is idempotent for the same process (not fresh, file untouched)', () => {
    const d = deps({ fs: fakeFs({ [PATH]: holder(100) }), alive: [100] });
    expect(acquireBridgeLock('9222', d)?.fresh).toBe(false);
    expect(d.fs.files.get(PATH)).toBe(holder(100));
  });

  it('is skipped entirely with TV_ALLOW_SHARED_CHROME=1', () => {
    const d = deps({ fs: fakeFs({ [PATH]: holder(42) }), alive: [42], env: { TV_ALLOW_SHARED_CHROME: '1' } });
    expect(acquireBridgeLock('9222', d)).toBeNull();
  });

  it('rethrows file errors other than an existing lock', () => {
    const d = deps();
    d.fs.writeExclusive = () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    };
    expect(() => acquireBridgeLock('9222', d)).toThrow('EACCES');
  });
});

describe('release', () => {
  it('removes the file while it still holds this pid', () => {
    const d = deps();
    acquireBridgeLock('9222', d)!.release();
    expect(d.fs.files.has(PATH)).toBe(false);
  });

  it('leaves a file another process has taken over', () => {
    const d = deps();
    const lock = acquireBridgeLock('9222', d)!;
    d.fs.files.set(PATH, holder(77));
    lock.release();
    expect(d.fs.files.get(PATH)).toBe(holder(77));
  });

  it('never throws when the file is already gone', () => {
    const d = deps();
    const lock = acquireBridgeLock('9222', d)!;
    d.fs.files.delete(PATH);
    expect(() => lock.release()).not.toThrow();
  });
});

describe('installReleaseOnExit', () => {
  it('registers exit, SIGINT and SIGTERM once and exits after a signal', () => {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const proc = { once: (event: string, fn: () => void) => void handlers.set(event, fn), exit: (code: number) => void exits.push(code) };
    let released = 0;
    installReleaseOnExit(() => void (released += 1), proc);
    installReleaseOnExit(() => void (released += 100), proc);
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM', 'exit']);
    handlers.get('exit')!();
    handlers.get('SIGINT')!();
    expect(released).toBe(2);
    expect(exits).toEqual([130]);
  });
});

describe('real dependencies (no file is touched)', () => {
  it('sees this process as alive and an unused pid as dead', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });

  it('wires the OS temp dir, this pid and the environment', () => {
    const real = nodeLockDeps();
    expect(real.pid).toBe(process.pid);
    expect(real.tmpdir.length).toBeGreaterThan(0);
    expect(real.env).toBe(process.env);
    expect(typeof real.fs.writeExclusive).toBe('function');
  });
});