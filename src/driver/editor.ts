import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { sourcesEqual } from '../parsers/source.js';
import { withClipboardAccess } from './clipboard.js';
import { withTimeout } from './waits.js';
import {
  parseConsoleEntries,
  parseProblemCodes,
  type ConsoleEntry,
  type ProblemCode,
} from '../parsers/console.js';

const SURFACE = `${SEL.overlayRoot} ${SEL.editorSurface}`;
/** Bound for the clipboard read-back, so one hung call cannot hold the driver mutex forever. */
const CLIPBOARD_READ_TIMEOUT_MS = 10_000;

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
  const copied = await withTimeout(
    page.evaluate(() => navigator.clipboard.readText()),
    CLIPBOARD_READ_TIMEOUT_MS,
    () => new TvError('PASTE_MISMATCH', `Reading the clipboard did not finish within ${CLIPBOARD_READ_TIMEOUT_MS} ms`),
  );
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

/** Pastes the source and returns what the editor holds afterwards (one clipboard grant/restore). */
export async function writeAndReadBack(page: Page, source: string): Promise<string> {
  return withClipboardAccess(page, async () => {
    await pasteRaw(page, source);
    return copyRaw(page);
  });
}

export function pasteMismatch(source: string, actual: string): TvError {
  return new TvError('PASTE_MISMATCH', 'Editor content differs from the source that was pasted', {
    expectedLength: source.length,
    actualLength: actual.length,
  });
}

export async function writeAndVerify(page: Page, source: string): Promise<void> {
  const actual = await writeAndReadBack(page, source);
  if (!sourcesEqual(source, actual)) throw pasteMismatch(source, actual);
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
