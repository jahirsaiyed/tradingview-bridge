import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';

const CLOSE_CLICK_TIMEOUT_MS = 1500;
const CLOSED_TIMEOUT_MS = 5000;

/**
 * Closes TradingView's Help Center overlay with its own Close button (Escape does not close it) and
 * waits, bounded, until it is gone. Returns true when the overlay is no longer shown.
 */
export async function closeHelpCenter(page: Page): Promise<boolean> {
  const dialog = page.locator(SEL.supportDialog);
  if ((await dialog.count()) === 0) return true;
  // Live: two "Close" buttons exist and the first (a fixed-header copy) is covered by the second, so try
  // the last one first and fall back to the others.
  const buttons = dialog.getByRole('button', { name: 'Close', exact: true });
  for (let i = (await buttons.count()) - 1; i >= 0; i -= 1) {
    const clicked = await buttons
      .nth(i)
      .click({ timeout: CLOSE_CLICK_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
    if (clicked) break;
  }
  return dialog
    .first()
    .waitFor({ state: 'hidden', timeout: CLOSED_TIMEOUT_MS })
    .then(
      () => true,
      () => false,
    );
}
