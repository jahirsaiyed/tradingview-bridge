import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import type { LayoutMode } from './layout.js';
import type { SelftestPayload } from './types.js';

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

export interface SelftestLayout {
  ensureOverlay(): Promise<LayoutMode>;
  detect(): Promise<LayoutMode>;
}

function describeError(error: unknown): string {
  if (error instanceof TvError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the overlay editor, then checks the selectors. A layout failure does not abort the selftest:
 * it is reported as layoutError and the selectors are still checked (required ones then show up as
 * failures), so a broken editor UI is diagnosed instead of hidden behind the layout error.
 */
export async function selftestAfterLayout(page: Page, layout: SelftestLayout): Promise<SelftestPayload> {
  let mode: LayoutMode;
  let layoutError: string | null = null;
  try {
    mode = await layout.ensureOverlay();
  } catch (error) {
    layoutError = describeError(error);
    mode = await layout.detect().catch((): LayoutMode => 'closed');
  }
  const checks = await runSelftest(page);
  const payload = { layout: mode, checks, failures: summarizeChecks(checks) };
  return layoutError === null ? payload : { ...payload, layoutError };
}
