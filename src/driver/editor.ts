import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { sourcesEqual } from '../parsers/source.js';
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

export async function pasteSource(page: Page, source: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await focusEditor(page);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
}

export async function copySource(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
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

export async function writeAndVerify(page: Page, source: string): Promise<void> {
  await pasteSource(page, source);
  const actual = await copySource(page);
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

export async function triggerCompile(page: Page): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press('Control+Enter');
}
