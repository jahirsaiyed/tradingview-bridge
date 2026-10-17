import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { withBeforeUnloadAccept } from './dialogs.js';
import { assertTradingViewChartUrl } from './chartUrl.js';
import { parseChartLabel, type ChartLabel } from '../parsers/chart.js';

export async function readChartLabel(page: Page): Promise<ChartLabel | null> {
  const label = await page
    .locator(SEL.chartCanvas)
    .first()
    .getAttribute('aria-label', { timeout: 3000 })
    .catch(() => null);
  return label ? parseChartLabel(label) : null;
}

// Heuristic: the sign-in button is absent when logged in. Confirmed only for the logged-in state.
export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await page.locator(SEL.signInButton).count()) === 0;
}

// Same heuristic as isLoggedIn, so it is trusted only to pass on the logged-in chart (proved live).
export async function ensureLoggedIn(page: Page): Promise<void> {
  if (!(await isLoggedIn(page))) {
    throw new TvError(
      'NOT_LOGGED_IN',
      'TradingView shows the sign-in button: log in in the dedicated Chrome window, then retry',
    );
  }
}

export async function takeScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: 'png' });
}

export async function navigateToChart(
  page: Page,
  args: { symbol?: string; interval?: string },
): Promise<string> {
  if (!args.symbol && !args.interval) {
    throw new TvError('INVALID_ARGUMENT', 'Provide a symbol, an interval, or both');
  }
  assertTradingViewChartUrl(page.url());
  const url = new URL(page.url());
  if (args.symbol) url.searchParams.set('symbol', args.symbol);
  if (args.interval) url.searchParams.set('interval', args.interval);
  await withBeforeUnloadAccept(page, async () => {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await page.locator(SEL.chartCanvas).first().waitFor({ timeout: 30_000 });
  });
  return page.url();
}
