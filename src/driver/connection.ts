import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveCdpEndpoint } from '../config.js';
import { TvError } from '../result.js';
import { isTradingViewChartUrl } from './chartUrl.js';

/** Default bound for Playwright actions without an explicit timeout. */
export const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
/**
 * Navigation (goto/reload) stays at 30 s. It must be set explicitly: without a navigation default,
 * Playwright falls back to the action default (10 s) for navigations too.
 */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** Applies both page defaults: 10 s for actions, 30 s for navigation. */
export function applyPageTimeouts(page: Page): void {
  page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
}

export interface Connection {
  readonly browser: Browser;
  readonly page: Page;
}

export async function connect(endpoint: string = resolveCdpEndpoint()): Promise<Connection> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch {
    throw new TvError(
      'NOT_CONNECTED',
      `Cannot reach Chrome at ${endpoint}. Start it with scripts/launch-chrome.ps1 and log in to TradingView.`,
      { endpoint },
    );
  }
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => isTradingViewChartUrl(candidate.url()));
  if (!page) {
    throw new TvError('NO_CHART', 'No TradingView chart tab is open in the dedicated Chrome', { endpoint });
  }
  applyPageTimeouts(page);
  return { browser, page };
}
