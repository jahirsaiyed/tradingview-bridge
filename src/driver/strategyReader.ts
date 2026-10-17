import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { parseKeyStats, parseTradeRows, type KeyStats, type Trade } from '../parsers/strategy.js';
import { pollUntil } from './waits.js';

const DEFAULT_REPORT_TIMEOUT_MS = 30_000;

async function smallestTextContaining(page: Page, needles: readonly string[]): Promise<string | null> {
  return page.evaluate((wanted: string[]) => {
    let best: string | null = null;
    for (const element of Array.from(document.querySelectorAll('div'))) {
      const text = (element as HTMLElement).innerText;
      if (!text || !wanted.every((needle) => text.includes(needle))) continue;
      if (best === null || text.length < best.length) best = text;
    }
    return best;
  }, [...needles]);
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

export async function readKeyStats(
  page: Page,
  timeoutMs: number = DEFAULT_REPORT_TIMEOUT_MS,
): Promise<KeyStats> {
  await openTab(page, SEL.reportTab, 'Strategy report');
  const text = await pollUntil(() => smallestTextContaining(page, TEXT.reportLabels), {
    timeoutMs,
    intervalMs: 500,
  });
  if (!text) {
    throw new TvError('TIMEOUT_REPORT', `The Strategy Tester report did not render within ${timeoutMs} ms`, {
      timeoutMs,
    });
  }
  return parseKeyStats(text);
}

export async function readTrades(
  page: Page,
  limit: number,
): Promise<{ trades: Trade[]; unparsed: number }> {
  await openTab(page, SEL.tradesTab, 'List of Trades');
  const rows = await pollUntil(
    async () => {
      const texts = await page.locator('[role="row"], tr').allInnerTexts();
      return texts.some((text) => /^\s*\d+(Long|Short)/.test(text)) ? texts : null;
    },
    { timeoutMs: 5000, intervalMs: 500 },
  );
  const parsed = parseTradeRows(rows ?? []);
  await page.locator(SEL.reportTab).first().click().catch(() => undefined);
  return { trades: parsed.trades.slice(0, limit), unparsed: parsed.unparsed };
}
