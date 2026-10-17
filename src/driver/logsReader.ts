import type { Page } from 'playwright-core';
import { parsePineLogs, type PineLogLine } from '../parsers/logs.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { pollUntil } from './waits.js';

async function collectLogLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pattern = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\]:/;
    const candidates = Array.from(document.querySelectorAll('div')).filter((element) =>
      pattern.test(((element as HTMLElement).innerText ?? '').trim()),
    );
    const innermost = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
    );
    return innermost.map((element) => (element as HTMLElement).innerText.trim());
  });
}

async function logsOrEmptyState(page: Page): Promise<string[] | null> {
  const lines = await collectLogLines(page);
  if (lines.length > 0) return lines;
  const empty = await page.getByText('No data', { exact: true }).first().isVisible().catch(() => false);
  return empty ? [] : null;
}

export async function readPineLogs(
  page: Page,
  ops: LayoutOps,
): Promise<{ lines: PineLogLine[]; layoutRestored: boolean }> {
  await ensureLayout(ops, 'split');
  let layoutRestored = false;
  let rawLines: string[] = [];
  try {
    rawLines = (await pollUntil(async () => logsOrEmptyState(page), { timeoutMs: 8000, intervalMs: 500 })) ?? [];
  } finally {
    // Restoration failure is reported, not thrown, so the data already read is not lost.
    layoutRestored = await ensureLayout(ops, 'overlay').then(
      () => true,
      () => false,
    );
  }
  return { lines: parsePineLogs(rawLines), layoutRestored };
}
