import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { isSessionDisconnectedText } from './session.js';
import { withTimeout } from './waits.js';

const BODY_READ_TIMEOUT_MS = 3000;

const DISCONNECTED_MESSAGE =
  'TradingView shows "Session disconnected": the account was opened on another browser or device and only ' +
  'one session is allowed. To continue, click Connect in the dedicated Chrome window yourself; this ends the ' +
  'other session. The bridge never clicks it.';

/** Reads the body text once, without waiting for any element; false when it cannot be read in time. */
export async function isSessionDisconnected(page: Page, timeoutMs: number = BODY_READ_TIMEOUT_MS): Promise<boolean> {
  try {
    const text = await withTimeout(
      page.evaluate(() => document.body?.innerText ?? ''),
      timeoutMs,
      () => new Error('body text read timed out'),
    );
    return isSessionDisconnectedText(String(text));
  } catch {
    return false; // unreadable: the other guards and the bounded waits still apply
  }
}

export async function ensureSessionConnected(page: Page): Promise<void> {
  if (await isSessionDisconnected(page)) {
    throw new TvError('SESSION_DISCONNECTED', DISCONNECTED_MESSAGE);
  }
}
