import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TvError } from '../result.js';

/**
 * One bridge process per dedicated Chrome. The driver mutex only serializes calls inside one process; two
 * processes (two MCP servers, or a smoke run next to a server) interleave keystrokes and clipboard use. A lock
 * file in the OS temp dir, keyed by the CDP port, makes the second process fail with BRIDGE_BUSY instead.
 */
export interface LockFs {
  /** Creates the file; throws an error with code 'EEXIST' when it already exists. */
  writeExclusive(path: string, data: string): void;
  read(path: string): string;
  remove(path: string): void;
}

export interface LockDeps {
  readonly fs: LockFs;
  readonly isAlive: (pid: number) => boolean;
  readonly pid: number;
  readonly tmpdir: string;
  readonly now: () => number;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface BridgeLock {
  readonly path: string;
  /** False when this process already held the lock (a reconnect): its connect failure must not release it. */
  readonly fresh: boolean;
  /** Removes the file only while it still names this process; never throws. */
  release(): void;
}

export const OVERRIDE_ENV = 'TV_ALLOW_SHARED_CHROME';
const MAX_ATTEMPTS = 3;

export function portOfEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

export function lockPath(dir: string, port: string): string {
  return join(dir, `tradingview-bridge-cdp-${port}.lock`);
}

/** The pid written in the lock file; null when the file is gone or corrupt. */
function readHolder(path: string, fs: LockFs): number | null {
  try {
    const pid: unknown = (JSON.parse(fs.read(path)) as { pid?: unknown }).pid;
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function busyError(pid: number, path: string): TvError {
  return new TvError(
    'BRIDGE_BUSY',
    `Another bridge process (process ${pid}) is already driving the dedicated Chrome. Only one bridge ` +
      'process may drive it at a time: two would interleave editor keystrokes and clipboard use. Stop the other ' +
      `MCP server or smoke run first. To knowingly run two anyway, set ${OVERRIDE_ENV}=1.`,
    { pid, lockFile: path },
  );
}

function handle(path: string, deps: LockDeps, fresh: boolean): BridgeLock {
  return {
    path,
    fresh,
    release: () => {
      try {
        if (readHolder(path, deps.fs) === deps.pid) deps.fs.remove(path);
      } catch {
        // Already gone: nothing to release.
      }
    },
  };
}

function tryCreate(path: string, deps: LockDeps): boolean {
  try {
    deps.fs.writeExclusive(path, JSON.stringify({ pid: deps.pid, startedAt: deps.now() }));
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    return false;
  }
}

/**
 * Takes the lock for `port`: creates it, re-uses it when this process holds it, takes over a file whose
 * process is dead or whose content is corrupt, and fails with BRIDGE_BUSY while another live process holds
 * it. Returns null (no lock) when TV_ALLOW_SHARED_CHROME=1.
 */
export function acquireBridgeLock(port: string, deps: LockDeps): BridgeLock | null {
  if (deps.env[OVERRIDE_ENV] === '1') return null;
  const path = lockPath(deps.tmpdir, port);
  let lastHolder: number | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (tryCreate(path, deps)) return handle(path, deps, true);
    lastHolder = readHolder(path, deps.fs);
    if (lastHolder === deps.pid) return handle(path, deps, false);
    if (lastHolder !== null && deps.isAlive(lastHolder)) throw busyError(lastHolder, path);
    try {
      deps.fs.remove(path); // dead holder or corrupt file
    } catch {
      // Removed by someone else meanwhile: just try again.
    }
  }
  throw busyError(lastHolder ?? 0, path);
}

export interface ExitHooks {
  once(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): unknown;
}

const installed = new WeakSet<object>();

/** Releases the lock when the process ends; registered once per process object. */
export function installReleaseOnExit(release: () => void, proc: ExitHooks = process): void {
  if (installed.has(proc)) return;
  installed.add(proc);
  proc.once('exit', release);
  proc.once('SIGINT', () => {
    release();
    proc.exit(130);
  });
  proc.once('SIGTERM', () => {
    release();
    proc.exit(143);
  });
}

/** True while a process with this pid exists (signal 0 only checks; EPERM means it exists under another user). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 'EPERM'; // exists, owned by another user
  }
}

/** The real file system, pid check and temp dir. */
export function nodeLockDeps(): LockDeps {
  return {
    fs: {
      writeExclusive: (path, data) => writeFileSync(path, data, { flag: 'wx' }),
      read: (path) => readFileSync(path, 'utf8'),
      remove: (path) => unlinkSync(path),
    },
    isAlive: isProcessAlive,
    pid: process.pid,
    tmpdir: tmpdir(),
    now: Date.now,
    env: process.env,
  };
}
