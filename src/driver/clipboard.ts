import type { BrowserContext, Page } from 'playwright-core';
import { assertTradingViewChartUrl } from './chartUrl.js';

export type ClipboardPage = Pick<Page, 'url' | 'evaluate'> & {
  context(): Pick<BrowserContext, 'grantPermissions' | 'clearPermissions'>;
};

const PERMISSIONS = ['clipboard-read', 'clipboard-write'];

// Best effort. null means "unknown" (unreadable or non-text), which is never written back.
async function readPreviousText(page: ClipboardPage): Promise<string | null> {
  try {
    const text: unknown = await page.evaluate(() => navigator.clipboard.readText());
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

async function restoreText(page: ClipboardPage, text: string | null): Promise<void> {
  if (text === null) return;
  await page.evaluate((value) => navigator.clipboard.writeText(value), text).catch(() => undefined);
}

/**
 * Runs fn with clipboard access on the chart page: grants the permissions, remembers the user's
 * clipboard text, and ALWAYS restores that text (when it was known) and clears the permissions
 * afterwards. Cleanup errors are swallowed so the original error propagates. The previous text is
 * only held in memory, never logged or returned.
 * Caveats: clearPermissions() resets ALL permission overrides of the browser context, not only the
 * clipboard ones (acceptable in the dedicated automation profile). Restoring the previous text may
 * overwrite text the user copied while the tool call was running.
 */
export async function withClipboardAccess<T>(page: ClipboardPage, fn: () => Promise<T>): Promise<T> {
  const url = page.url();
  assertTradingViewChartUrl(url);
  const context = page.context();
  let previous: string | null = null;
  try {
    await context.grantPermissions(PERMISSIONS, { origin: new URL(url).origin });
    previous = await readPreviousText(page);
    return await fn();
  } finally {
    await restoreText(page, previous);
    await context.clearPermissions().catch(() => undefined);
  }
}
