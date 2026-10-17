import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';

export interface SelectorCheck {
  readonly name: string;
  readonly selector: string;
  readonly found: boolean;
  readonly required: boolean;
}

const CHECKS: ReadonlyArray<{ name: string; selector: string; required: boolean }> = [
  { name: 'overlayRoot', selector: SEL.overlayRoot, required: true },
  { name: 'editorSurface', selector: `${SEL.overlayRoot} ${SEL.editorSurface}`, required: true },
  { name: 'overlayMoreButton', selector: SEL.overlayMoreButton, required: true },
  { name: 'chartCanvas', selector: SEL.chartCanvas, required: true },
  { name: 'legendToggler', selector: SEL.legendToggler, required: false },
  { name: 'reportTab', selector: SEL.reportTab, required: false },
  { name: 'tradesTab', selector: SEL.tradesTab, required: false },
];

export function summarizeChecks(checks: readonly SelectorCheck[]): string[] {
  return checks.filter((check) => check.required && !check.found).map((check) => check.name);
}

export async function runSelftest(page: Page): Promise<SelectorCheck[]> {
  return Promise.all(
    CHECKS.map(async (check) => ({
      ...check,
      found: (await page.locator(check.selector).count()) > 0,
    })),
  );
}
