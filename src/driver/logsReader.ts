import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { emptyLogsHint, parsePineLogs, settleLogsObservation } from '../parsers/logs.js';
import type { PineLogsPayload } from './types.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { pollUntil } from './waits.js';

const LOGS_TIMEOUT_MS = 8000;
const LOGS_INTERVAL_MS = 500;
const EMPTY_GRACE_MS = 2500;

// Scoped to the Pine logs widget (live-verified container), not every div on the page.
async function collectLogLines(page: Page): Promise<string[]> {
  return page.evaluate((scopeSelector) => {
    const scope = document.querySelector(scopeSelector);
    if (!scope) return [];
    const pattern = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\]:/;
    const candidates = Array.from(scope.querySelectorAll('div')).filter((element) =>
      pattern.test(((element as HTMLElement).innerText ?? '').trim()),
    );
    const innermost = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
    );
    return innermost.map((element) => (element as HTMLElement).innerText.trim());
  }, SEL.pineLogsWidget);
}

async function visibleEmptyState(page: Page): Promise<string | null> {
  const widget = page.locator(SEL.pineLogsWidget);
  for (const text of TEXT.pineLogsEmptyStates) {
    const visible = await widget.getByText(text, { exact: true }).first().isVisible().catch(() => false);
    if (visible) return text;
  }
  return null;
}

interface LogsRead {
  readonly rawLines: readonly string[];
  readonly emptyText: string | null;
}

// Polls until log lines render or an empty state persists. null means the pane never rendered.
async function waitForLogs(page: Page): Promise<LogsRead | null> {
  let emptySince: number | null = null;
  let emptyText: string | null = null;
  const settled = await pollUntil(
    async () => {
      const lines = await collectLogLines(page);
      emptyText = lines.length === 0 ? await visibleEmptyState(page) : null;
      const empty = emptyText !== null;
      const step = settleLogsObservation({ lines, empty }, emptySince, Date.now(), EMPTY_GRACE_MS);
      emptySince = step.emptySince;
      return step.result;
    },
    { timeoutMs: LOGS_TIMEOUT_MS, intervalMs: LOGS_INTERVAL_MS },
  );
  // An empty state seen too late to finish its grace period still proves the pane rendered.
  if (settled !== null) return { rawLines: settled, emptyText };
  return emptySince !== null ? { rawLines: [], emptyText } : null;
}

export async function readPineLogs(
  page: Page,
  ops: LayoutOps,
): Promise<PineLogsPayload> {
  await ensureLayout(ops, 'split');
  let layoutRestored = false;
  let read: LogsRead | null = null;
  try {
    read = await waitForLogs(page);
  } finally {
    // Restoration failure is reported, not thrown, so the data already read is not lost.
    layoutRestored = await ensureLayout(ops, 'overlay').then(
      () => true,
      () => false,
    );
  }
  // Thrown only after the layout was restored: neither log lines nor the empty state rendered.
  if (read === null) {
    throw new TvError('TIMEOUT_REPORT', `The Pine logs pane did not render within ${LOGS_TIMEOUT_MS} ms`, {
      layoutRestored,
    });
  }
  const lines = parsePineLogs(read.rawLines);
  return lines.length > 0 ? { lines, layoutRestored } : { lines, layoutRestored, emptyHint: emptyLogsHint(read.emptyText) };
}
