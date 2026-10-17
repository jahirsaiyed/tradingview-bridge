import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { closeHelpCenter } from './helpCenter.js';
import { detectLayout, type LayoutMode, type LayoutOps, type LayoutStep } from './layout.js';

const VISIBLE_TIMEOUT_MS = 10_000;

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function dismissSplitDialog(page: Page): Promise<void> {
  const title = page.getByText(TEXT.splitDialogTitle, { exact: true });
  const appeared = await title.waitFor({ state: 'visible', timeout: 1500 }).then(
    () => true,
    () => false,
  );
  if (appeared) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
}

// A misclick on the row's "?" icon opens the Help Center: close it with its own button, then report it.
async function helpCenterOpened(page: Page): Promise<TvError> {
  const closed = await closeHelpCenter(page);
  const message = closed
    ? 'The Help Center opened instead of the Pine logs panel; the bridge closed it. Retry.'
    : 'The Help Center opened instead of the Pine logs panel and could not be closed. Close it manually, then retry.';
  return new TvError('UNEXPECTED_DIALOG', message, { dialog: TEXT.helpCenter, closed });
}

async function openPineLogs(page: Page): Promise<void> {
  await page.locator(SEL.overlayMoreButton).click();
  // Click the left edge of the row: the row's centre can hit the "?" help icon.
  // Scope to the open menu: a hidden "Pine logs" widget title also exists in the page sidebar.
  await page.locator(SEL.menu).getByText(TEXT.pineLogsMenu, { exact: true }).click({ position: { x: 8, y: 8 } });
  const confirm = page.getByRole('button', { name: TEXT.splitConfirm });
  const help = page.locator(SEL.supportDialog).first();
  const seen = await Promise.race([
    confirm.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'confirm' as const),
    help.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'help' as const),
  ]).catch(() => 'none' as const);
  if (seen === 'help') throw await helpCenterOpened(page);
  if (seen === 'confirm') await confirm.click();
  try {
    await page.locator(SEL.splitRoot).waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
  } catch {
    throw new TvError('LAYOUT_FAILED', 'The split layout did not appear after requesting Pine logs', { seen });
  }
}

async function runStep(page: Page, step: LayoutStep): Promise<void> {
  if (step === 'openEditor') {
    await page.locator(SEL.openEditorButton).click();
  } else if (step === 'toOverlay') {
    await page.locator(SEL.toOverlayButton).click();
  } else {
    await openPineLogs(page);
    return;
  }
  await page.locator(SEL.overlayRoot).first().waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
  if (step === 'toOverlay') await dismissSplitDialog(page);
}

export function createPageLayoutOps(page: Page): LayoutOps {
  return {
    async detect(): Promise<LayoutMode> {
      return detectLayout({
        overlayVisible: await isVisible(page, SEL.overlayRoot),
        splitVisible: await isVisible(page, SEL.splitRoot),
      });
    },
    run: (step) => runStep(page, step),
  };
}
