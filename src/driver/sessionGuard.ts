import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { isSessionDisconnectedText } from './session.js';
import { withTimeout } from './waits.js';

const BODY_READ_TIMEOUT_MS = 3000;

/**
 * Page areas whose text is NOT checked: the Pine Editor (the user's script text), the Pine logs, the
 * Strategy Tester, the chart legends, and scripts/styles. A script or a log line quoting the modal's
 * words must not block every tool.
 */
export const SESSION_TEXT_EXCLUDED = [
  'script',
  'style',
  'noscript',
  '.monaco-editor',
  '#pine-editor-dialog',
  '[data-name="pine-dialog"]',
  '.widgetbar-widget-pine_logs',
  '[data-test-id-widget-type="pine_logs"]',
  '#bottom-area',
  '[data-qa-id="legend"]',
] as const;

/**
 * Runs IN THE PAGE (passed to page.evaluate, so it must stay self-contained, without named inner
 * functions): the body's text nodes outside the excluded areas, in document order, space-joined.
 */
export function collectPageText(excluded: readonly string[]): string {
  const parts: string[] = [];
  const stack: Node[] = document.body ? [document.body] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === 1 && !excluded.some((selector) => (node as Element).matches(selector))) {
      for (let i = node.childNodes.length - 1; i >= 0; i -= 1) stack.push(node.childNodes[i]!);
    }
  }
  return parts.join(' ');
}

const DISCONNECTED_MESSAGE =
  'TradingView shows "Session disconnected": the account was opened on another browser or device and only ' +
  'one session is allowed. To continue, click Connect in the dedicated Chrome window yourself; this ends the ' +
  'other session. The bridge never clicks it.';

/** One bounded evaluate, without waiting for any element; false when the text cannot be read in time. */
export async function isSessionDisconnected(page: Page, timeoutMs: number = BODY_READ_TIMEOUT_MS): Promise<boolean> {
  try {
    const text = await withTimeout(
      page.evaluate(collectPageText, [...SESSION_TEXT_EXCLUDED]),
      timeoutMs,
      () => new Error('page text read timed out'),
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
