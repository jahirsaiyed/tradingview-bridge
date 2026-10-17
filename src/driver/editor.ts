import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { sourcesEqual } from '../parsers/source.js';
import { withClipboardAccess } from './clipboard.js';
import {
  parseConsoleEntries,
  parseProblemCodes,
  type ConsoleEntry,
  type ProblemCode,
} from '../parsers/console.js';

const SURFACE = `${SEL.overlayRoot} ${SEL.editorSurface}`;

async function focusEditor(page: Page): Promise<void> {
  await page.locator(SURFACE).first().click();
}

// The *Raw helpers assume clipboard access is already granted by withClipboardAccess.
async function pasteRaw(page: Page, source: string): Promise<void> {
  await focusEditor(page);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
}

async function copyRaw(page: Page): Promise<string> {
  const sentinel = `__tv_bridge_sentinel__${Date.now()}`;
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  await focusEditor(page);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (copied === sentinel) {
    throw new TvError('PASTE_MISMATCH', 'Could not read the editor contents (copy produced no text)');
  }
  return copied;
}

export async function pasteSource(page: Page, source: string): Promise<void> {
  await withClipboardAccess(page, () => pasteRaw(page, source));
}

export async function copySource(page: Page): Promise<string> {
  return withClipboardAccess(page, () => copyRaw(page));
}

export async function writeAndVerify(page: Page, source: string): Promise<void> {
  // One clipboard grant/restore/clear around both the paste and the read-back.
  const actual = await withClipboardAccess(page, async () => {
    await pasteRaw(page, source);
    return copyRaw(page);
  });
  if (!sourcesEqual(source, actual)) {
    throw new TvError('PASTE_MISMATCH', 'Editor content differs from the source that was pasted', {
      expectedLength: source.length,
      actualLength: actual.length,
    });
  }
}

export async function readConsole(
  page: Page,
): Promise<{ entries: ConsoleEntry[]; problems: ProblemCode[] }> {
  const text = await page.locator(SEL.overlayRoot).first().innerText();
  return { entries: parseConsoleEntries(text), problems: parseProblemCodes(text) };
}

/**
 * Compiles the editor source. Returns false, without compiling, when the source is identical to
 * the last compiled version: TradingView disables the apply button then and Ctrl+Enter is a no-op.
 */
export async function triggerCompile(page: Page): Promise<boolean> {
  const apply = page.locator(SEL.applyToChartButton).first();
  if ((await apply.count()) > 0 && (await apply.isDisabled({ timeout: 2000 }))) return false;
  await focusEditor(page);
  await page.keyboard.press('Control+Enter');
  return true;
}
