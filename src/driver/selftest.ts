import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import type { LayoutMode } from './layout.js';
import { decideConsole, readConsolePaneState } from './consolePane.js';
import type { ConsoleStatus, SelftestPayload } from './types.js';

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
  // Compiles read the console: the pane (open or collapsed) or at least its toggle must exist.
  { name: 'consolePane', selector: `${SEL.consolePane}, ${SEL.consoleToggle}`, required: true },
  { name: 'legendToggler', selector: SEL.legendToggler, required: false },
  { name: 'reportTab', selector: SEL.reportTab, required: false },
  { name: 'tradesTab', selector: SEL.tradesTab, required: false },
  { name: 'reportKeyFacts', selector: SEL.reportKeyFacts, required: false },
  { name: 'reportStrategyName', selector: SEL.reportStrategyName, required: false },
  // Optional: these exist only while a strategy report is open.
  { name: 'reportRoot', selector: SEL.reportRoot, required: false },
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

/** Read-only: the selftest reports the console pane state but never opens it (tv_compile does). */
async function consoleStatus(page: Page): Promise<ConsoleStatus> {
  const state = await readConsolePaneState(page).catch(() => null);
  if (state === null) return 'missing';
  const decision = decideConsole(state);
  if (decision === 'ready') return 'open';
  return decision === 'missing' ? 'missing' : 'collapsed';
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
  const payload = { layout: mode, console: await consoleStatus(page), checks, failures: summarizeChecks(checks) };
  return layoutError === null ? payload : { ...payload, layoutError };
}
