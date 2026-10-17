import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { parseKeyStats, parseTradeRows, type KeyStats, type Trade } from '../parsers/strategy.js';
import { capMs, deadlineError, type Deadline } from './deadline.js';
import { STRATEGY_NAME_TIMEOUT_MS, TRADE_ROWS_TIMEOUT_MS } from './reportFlow.js';
import { pollStable, pollUntil } from './waits.js';

const DEFAULT_REPORT_TIMEOUT_MS = 30_000;
/** Two identical Key stats reads this far apart count as a settled report. */
const STABLE_READ_INTERVAL_MS = 700;
const STABLE_TIMEOUT_MS = 15_000;
/** Upper bound of one Strategy Tester tab click; less when the caller's budget has less left. */
const TAB_CLICK_MAX_MS = 5000;

/** A tab click bound from the time a caller allows: at most 5 s, never 0 (0 means no timeout in Playwright). */
export function tabClickMs(allowedMs: number): number {
  return Math.max(1, Math.min(TAB_CLICK_MAX_MS, allowedMs));
}

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

async function openTab(page: Page, selector: string, name: string, clickMs: number): Promise<void> {
  const tab = page.locator(selector).first();
  if (!(await tab.isVisible().catch(() => false))) {
    throw new TvError(
      'SELECTOR_MISSING',
      `The Strategy Tester "${name}" tab is not visible. Add a strategy to the chart and open the Strategy Tester.`,
      { selector },
    );
  }
  await tab.click({ timeout: clickMs });
}

/**
 * Key stats once the report rendered (within `timeoutMs`) AND two consecutive reads ~700 ms apart
 * agree. A report that keeps changing for 15 s fails with TIMEOUT_REPORT (details.reason 'not-settled').
 * With a `deadline`, both waits are capped by it; a wait that fails once it is used up fails with
 * TIMEOUT_REPORT (details.reason 'deadline', phase 'report-render' or 'report-stable').
 */
export async function readKeyStats(
  page: Page,
  timeoutMs: number = DEFAULT_REPORT_TIMEOUT_MS,
  deadline?: Deadline,
): Promise<KeyStats> {
  const limit = (ms: number): number => (deadline ? deadline.cap(ms) : ms);
  const checkBudget = (phase: string): void => {
    if (deadline?.expired()) throw deadlineError('TIMEOUT_REPORT', phase, deadline);
  };
  await openTab(page, SEL.reportTab, 'Strategy report', deadline ? capMs(deadline, TAB_CLICK_MAX_MS) : TAB_CLICK_MAX_MS);
  const rendered = await pollUntil(() => readKeyFactsText(page), { timeoutMs: limit(timeoutMs), intervalMs: 500 });
  if (!rendered) {
    checkBudget('report-render');
    throw new TvError('TIMEOUT_REPORT', `The Strategy Tester report did not render within ${timeoutMs} ms`, {
      timeoutMs,
    });
  }
  const stable = await pollStable(() => readKeyFactsText(page), {
    timeoutMs: limit(STABLE_TIMEOUT_MS),
    intervalMs: STABLE_READ_INTERVAL_MS,
  });
  if (!stable) {
    checkBudget('report-stable');
    throw new TvError(
      'TIMEOUT_REPORT',
      `The Strategy Tester key stats kept changing for ${STABLE_TIMEOUT_MS} ms (still recalculating). Retry shortly.`,
      { timeoutMs: STABLE_TIMEOUT_MS, reason: 'not-settled' },
    );
  }
  return parseKeyStats(stable);
}

/** The name of the strategy whose report the Strategy Tester shows (its footer tab), or null. */
export async function readReportStrategyName(
  page: Page,
  timeoutMs: number = STRATEGY_NAME_TIMEOUT_MS,
): Promise<string | null> {
  const text = await page
    .locator(SEL.reportStrategyName)
    .first()
    .textContent({ timeout: timeoutMs })
    .catch(() => null);
  return text?.trim() || null;
}

export async function readTrades(
  page: Page,
  limit: number,
  rowsTimeoutMs: number = TRADE_ROWS_TIMEOUT_MS,
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
  await openTab(page, SEL.tradesTab, 'List of Trades', tabClickMs(rowsTimeoutMs));
  const rowLocator = page.locator(SEL.reportRoot).locator('[role="row"], tr');
  const rows = await pollUntil(
    async () => {
      const texts = await rowLocator.allInnerTexts();
      return texts.some((text) => /^\s*\d+(Long|Short)/.test(text)) ? texts : null;
    },
    { timeoutMs: rowsTimeoutMs, intervalMs: 500 },
  );
  const parsed = parseTradeRows(rows ?? []);
  await page.locator(SEL.reportTab).first().click({ timeout: tabClickMs(rowsTimeoutMs) }).catch(() => undefined);
  return { trades: parsed.trades.slice(0, limit), unparsed: parsed.unparsed };
}
