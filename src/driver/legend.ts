import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import type { LegendRow } from './ownership.js';

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
