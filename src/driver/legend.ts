import type { Locator, Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import type { LegendRow } from './ownership.js';
import { TvError } from '../result.js';
import { pollUntil } from './waits.js';

export async function listLegendRows(page: Page): Promise<LegendRow[]> {
  return page.evaluate(
    ([itemSelector, titleSelector, statusSelector]: string[]) =>
      Array.from(document.querySelectorAll(itemSelector!))
        .map((element) => ({
          entityId: element.getAttribute('data-entity-id') ?? '',
          title: ((element.querySelector(titleSelector!) as HTMLElement | null)?.innerText ?? '').trim(),
          status: element.querySelector(statusSelector!)?.getAttribute('title') ?? null,
        }))
        .filter((row) => row.entityId !== ''),
    [SEL.legendItem, SEL.legendTitle, SEL.legendStatus],
  );
}

export async function readStatusTitle(page: Page, entityId: string): Promise<string | null> {
  return page.evaluate(
    ([itemSelector, statusSelector, id]: string[]) => {
      const row = Array.from(document.querySelectorAll(itemSelector!)).find(
        (element) => element.getAttribute('data-entity-id') === id,
      );
      return row?.querySelector(statusSelector!)?.getAttribute('title') ?? null;
    },
    [SEL.legendItem, SEL.legendStatus, entityId],
  );
}

const ENTITY_ID = /^[A-Za-z0-9_-]+$/;
const RESTORE_ATTEMPTS = 5;
const RESTORE_SETTLE_MS = 400;

// The toggler re-renders right after a row is removed, so check the real state and retry.
async function recollapseLegend(legend: Locator, toggler: Locator): Promise<void> {
  const sources = legend.locator(SEL.legendSources);
  for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt += 1) {
    const isClosed = await sources.evaluate((element) => /closed/.test(element.className));
    if (isClosed) return;
    if (await toggler.isVisible().catch(() => false)) await toggler.click({ timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, RESTORE_SETTLE_MS));
  }
}

export async function removeLegendRow(
  page: Page,
  entityId: string,
): Promise<{ removed: boolean; reason?: string }> {
  if (!ENTITY_ID.test(entityId)) {
    throw new TvError('INTERNAL', `Unexpected legend entity id: ${entityId}`);
  }
  const row = page.locator(`${SEL.legendItem}[data-entity-id="${entityId}"]`);
  if ((await row.count()) === 0) {
    return { removed: false, reason: 'Legend row not found (already removed or the chart was reloaded)' };
  }
  // Resolve the legend by index, not through the row: the row detaches once it is removed.
  const legendIndex = await row.evaluate(
    (element, legendSelector) =>
      Array.from(document.querySelectorAll(legendSelector)).indexOf(element.closest(legendSelector)!),
    SEL.legendRoot,
  );
  const legend = page.locator(SEL.legendRoot).nth(legendIndex);
  const toggler = legend.locator(SEL.legendToggler);
  const wasCollapsed = await legend
    .locator(SEL.legendSources)
    .evaluate((element) => /closed/.test(element.className));
  // A collapsed legend is covered by a canvas that blocks pointer events: expand it first.
  if (wasCollapsed) await toggler.click({ timeout: 5000 });
  try {
    // The row's action buttons only receive pointer events while the row is hovered.
    await row.locator(SEL.legendTitle).first().hover({ timeout: 5000 });
    await row.locator(SEL.legendDelete).click({ timeout: 5000 });
    const gone = await pollUntil(async () => (await row.count()) === 0, { timeoutMs: 5000, intervalMs: 250 });
    if (!gone) {
      throw new TvError('REMOVE_FAILED', 'The legend row was still present after clicking Remove', { entityId });
    }
  } finally {
    // Best effort: never let the restore mask the original error.
    if (wasCollapsed) await recollapseLegend(legend, toggler).catch(() => undefined);
  }
  return { removed: true };
}
