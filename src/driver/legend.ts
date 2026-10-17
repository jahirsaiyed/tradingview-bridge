import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import type { LegendRow } from './ownership.js';
import { TvError } from '../result.js';
import { pollUntil } from './waits.js';

export async function listLegendRows(page: Page): Promise<LegendRow[]> {
  return page.evaluate(
    ([itemSelector, titleSelector]: string[]) =>
      Array.from(document.querySelectorAll(itemSelector!))
        .map((element) => ({
          entityId: element.getAttribute('data-entity-id') ?? '',
          title: ((element.querySelector(titleSelector!) as HTMLElement | null)?.innerText ?? '').trim(),
        }))
        .filter((row) => row.entityId !== ''),
    [SEL.legendItem, SEL.legendTitle],
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
  const legend = row.locator(`xpath=ancestor::*[@data-qa-id="legend"][1]`);
  const toggler = legend.locator(SEL.legendToggler);
  const wasCollapsed = await legend
    .locator(SEL.legendSources)
    .evaluate((element) => /closed/.test(element.className));
  // A collapsed legend is covered by a canvas that blocks pointer events: expand it first.
  if (wasCollapsed) await toggler.click();
  // The row's action buttons only receive pointer events while the row is hovered.
  await row.locator(SEL.legendTitle).first().hover({ timeout: 5000 });
  await row.locator(SEL.legendDelete).click({ timeout: 5000 });
  const gone = await pollUntil(async () => (await row.count()) === 0, { timeoutMs: 5000, intervalMs: 250 });
  if (!gone) {
    throw new TvError('REMOVE_FAILED', 'The legend row was still present after clicking Remove', { entityId });
  }
  if (wasCollapsed && (await toggler.isVisible().catch(() => false))) await toggler.click();
  return { removed: true };
}
