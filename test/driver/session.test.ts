import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { isSessionDisconnectedText } from '../../src/driver/session.js';
import { ensureSessionConnected, isSessionDisconnected } from '../../src/driver/sessionGuard.js';
import { TvError } from '../../src/result.js';

const REAL_TEXT =
  'Session disconnected Your session ended because your account was accessed from another browser or device. ' +
  'To comply with market data regulations, only one active session is allowed per user.';

describe('isSessionDisconnectedText', () => {
  it('detects the real modal text', () => {
    expect(isSessionDisconnectedText(REAL_TEXT)).toBe(true);
  });

  it('is case-insensitive and tolerant of whitespace and line breaks', () => {
    const messy = 'chart stuff\nSESSION   DISCONNECTED\n\nYour session ended because your account was accessed from\nanother  browser or\tdevice.';
    expect(isSessionDisconnectedText(messy)).toBe(true);
  });

  it('needs both the title and the other-device phrase', () => {
    expect(isSessionDisconnectedText('Session disconnected')).toBe(false);
    expect(isSessionDisconnectedText('accessed from another browser or device')).toBe(false);
  });

  it('does not fire on normal chart text', () => {
    expect(isSessionDisconnectedText('EURUSD 1h Pine Editor Strategy Tester Total PnL')).toBe(false);
    expect(isSessionDisconnectedText('')).toBe(false);
  });
});

function fakePage(evaluate: () => Promise<unknown>): Page {
  return { evaluate } as unknown as Page;
}

describe('session guard on a fake page', () => {
  it('passes on a normal chart page', async () => {
    const page = fakePage(async () => 'EURUSD Pine Editor Session History');
    await expect(ensureSessionConnected(page)).resolves.toBeUndefined();
    expect(await isSessionDisconnected(page)).toBe(false);
  });

  it('throws SESSION_DISCONNECTED with an actionable message when the modal is shown', async () => {
    const page = fakePage(async () => REAL_TEXT);
    expect(await isSessionDisconnected(page)).toBe(true);
    const error = await ensureSessionConnected(page).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('SESSION_DISCONNECTED');
    expect((error as TvError).message).toMatch(/click Connect in the dedicated Chrome window/);
    expect((error as TvError).message).toMatch(/ends the other session/);
    expect((error as TvError).message).toMatch(/never clicks it/);
  });

  it('treats an unreadable body as not disconnected (other guards still apply)', async () => {
    const page = fakePage(async () => {
      throw new Error('Execution context was destroyed');
    });
    expect(await isSessionDisconnected(page)).toBe(false);
    await expect(ensureSessionConnected(page)).resolves.toBeUndefined();
  });

  it('does not wait on a hung evaluate', async () => {
    const page = fakePage(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await isSessionDisconnected(page, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
