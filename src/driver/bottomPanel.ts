import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { pollUntil } from './waits.js';

const COLLAPSE_LABEL = 'Collapse panel';
const EXPAND_LABEL = 'Open panel';
const BOTTOM_AREA = '.layout__area--bottom';
const PANEL_SETTLE_MS = 5000;

type PanelState = 'open' | 'closed' | 'absent';

async function readPanelState(page: Page): Promise<PanelState> {
  const toggle = page.locator(SEL.bottomPanelToggle).first();
  if ((await toggle.count()) === 0) return 'absent';
  const label = await toggle.getAttribute('aria-label', { timeout: 2000 });
  if (label === COLLAPSE_LABEL) return 'open';
  if (label === EXPAND_LABEL) return 'closed';
  return 'absent';
}

// The toggle sits outside Playwright's reachable viewport, so click it through the DOM.
async function clickToggle(page: Page): Promise<void> {
  await page.locator(SEL.bottomPanelToggle).first().evaluate((element) => (element as HTMLElement).click(), undefined, {
    timeout: 2000,
  });
}

/**
 * Collapses the bottom (Strategy Tester) panel if it is open, to give the legend more height.
 * Returns true when this call collapsed it, so the caller can restore it afterwards.
 */
export async function collapseBottomPanel(page: Page): Promise<boolean> {
  if ((await readPanelState(page)) !== 'open') return false;
  try {
    await clickToggle(page);
    await pollUntil(async () => (await readPanelState(page)) === 'closed', {
      timeoutMs: PANEL_SETTLE_MS,
      intervalMs: 200,
    });
  } catch (error) {
    // The click may already have landed: restore here, since the caller never learns we collapsed it.
    await restoreBottomPanel(page).catch(() => undefined);
    throw error;
  }
  return true;
}

/**
 * Re-opens the bottom panel after collapseBottomPanel. If the panel closed itself or vanished
 * (TradingView removes it when the last strategy is removed), nothing is done.
 */
export async function restoreBottomPanel(page: Page): Promise<void> {
  if ((await readPanelState(page)) !== 'closed') return;
  // With no strategy left TradingView removes the panel (zero height) and the toggle is inert.
  const height = await page.locator(BOTTOM_AREA).first().evaluate((el) => el.getBoundingClientRect().height);
  if (height <= 0) return;
  await clickToggle(page);
  await pollUntil(async () => (await readPanelState(page)) === 'open', {
    timeoutMs: PANEL_SETTLE_MS,
    intervalMs: 200,
  });
}
