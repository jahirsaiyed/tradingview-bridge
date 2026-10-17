import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { parseKeyStats, parseTradeRows, type KeyStats, type Trade } from '../parsers/strategy.js';
import { pollStable, pollUntil } from './waits.js';

const DEFAULT_REPORT_TIMEOUT_MS = 30_000;
/** Two identical Key stats reads this far apart count as a settled report. */
const STABLE_READ_INTERVAL_MS = 700;
const STABLE_TIMEOUT_MS = 15_000;

/** The Key stats block text, or null until it renders with its labels. Scoped to the report container. */
async function readKeyFactsText(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ selector, labels }) => {
      const text = (document.querySelector(selector) as HTMLElement | null)?.innerText ?? '';
      return labels.every((label) => text.includes(label)) ? text : null;
    },
    { selector: SEL.reportKeyFacts, labels: [...TEXT.reportLabels] },
  );
}

async function openTab(page: Page, selector: string, name: string): Promise<void> {
  const tab = page.locator(selector).first();
  if (!(await tab.isVisible().catch(() => false))) {
    throw new TvError(
      'SELECTOR_MISSING',
      `The Strategy Tester "${name}" tab is not visible. Add a strategy to the chart and open the Strategy Tester.`,
      { selector },
    );
  }
  await tab.click();
}

/**
 * Key stats once the report rendered (within `timeoutMs`) AND two consecutive reads ~700 ms apart
 * agree. A report that keeps changing for 15 s fails with TIMEOUT_REPORT (details.reason 'not-settled').
 */
export async function readKeyStats(
  page: Page,
  timeoutMs: number = DEFAULT_REPORT_TIMEOUT_MS,
): Promise<KeyStats> {
  await openTab(page, SEL.reportTab, 'Strategy report');
  const rendered = await pollUntil(() => readKeyFactsText(page), { timeoutMs, intervalMs: 500 });
  if (!rendered) {
    throw new TvError('TIMEOUT_REPORT', `The Strategy Tester report did not render within ${timeoutMs} ms`, {
      timeoutMs,
    });
  }
  const stable = await pollStable(() => readKeyFactsText(page), {
    timeoutMs: STABLE_TIMEOUT_MS,
    intervalMs: STABLE_READ_INTERVAL_MS,
  });
  if (!stable) {
    throw new TvError(
      'TIMEOUT_REPORT',
      `The Strategy Tester key stats kept changing for ${STABLE_TIMEOUT_MS} ms (still recalculating). Retry shortly.`,
      { timeoutMs: STABLE_TIMEOUT_MS, reason: 'not-settled' },
    );
  }
  return parseKeyStats(stable);
}

/** The name of the strategy whose report the Strategy Tester shows (its footer tab), or null. */
export async function readReportStrategyName(page: Page): Promise<string | null> {
  const text = await page
    .locator(SEL.reportStrategyName)
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  return text?.trim() || null;
}

export async function readTrades(
  page: Page,
  limit: number,
): Promise<{ trades: Trade[]; unparsed: number }> {
  // The key stats rendered but the report container is not found: the container selector broke, which
  // would otherwise read as an empty trade list.
  const keyFactsShown = (await page.locator(SEL.reportKeyFacts).count()) > 0;
  if (keyFactsShown && (await page.locator(SEL.reportRoot).count()) === 0) {
    throw new TvError(
      'SELECTOR_MISSING',
      'The Strategy Tester report is open but its trades container was not found; the TradingView UI may have changed.',
      { selector: SEL.reportRoot },
    );
  }
  await openTab(page, SEL.tradesTab, 'List of Trades');
  const rowLocator = page.locator(SEL.reportRoot).locator('[role="row"], tr');
  const rows = await pollUntil(
    async () => {
      const texts = await rowLocator.allInnerTexts();
      return texts.some((text) => /^\s*\d+(Long|Short)/.test(text)) ? texts : null;
    },
    { timeoutMs: 5000, intervalMs: 500 },
  );
  const parsed = parseTradeRows(rows ?? []);
  await page.locator(SEL.reportTab).first().click().catch(() => undefined);
  return { trades: parsed.trades.slice(0, limit), unparsed: parsed.unparsed };
}
