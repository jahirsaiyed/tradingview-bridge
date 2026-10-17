import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveCdpEndpoint } from '../config.js';
import { TvError } from '../result.js';
import { isTradingViewChartUrl } from './chartUrl.js';

/** Default bound for Playwright actions without an explicit timeout (navigation keeps 30 s). */
export const DEFAULT_ACTION_TIMEOUT_MS = 10_000;

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
  page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
  return { browser, page };
}
