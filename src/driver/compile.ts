import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { readConsole, triggerCompile } from './editor.js';
import { freshEntries } from './compileState.js';
import { findNewCompileErrorRows } from './errorRows.js';
import { listLegendRows, removeLegendRow } from './legend.js';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from './ownership.js';
import { waitForRowSettled, type RowSettleResult } from './rowSettle.js';
import { pollUntil } from './waits.js';

export interface CompileReport {
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  /** True when an owned legend row was found, stopped calculating and its status was read. */
  readonly runtimeChecked: boolean;
  readonly ownedEntityId: string | null;
  /** Junk legend rows this compile created (failed compiles) and removed. */
  readonly cleanedErrorRows: number;
  /** True when the source matched the last compiled version, so nothing was compiled. */
  readonly unchanged: boolean;
  readonly elapsedMs: number;
}

export interface CompileArgs {
  readonly previousOwned: string | null;
  /** Declared script names (title and/or short title); empty when unknown. */
  readonly scriptTitles: readonly string[];
  readonly timeoutMs?: number;
  /** Bound for the owned row to stop calculating before its runtime status is read. */
  readonly runtimeTimeoutMs?: number;
}

const OWNED_ROW_TIMEOUT_MS = 5000;
const RUNTIME_SETTLE_TIMEOUT_MS = 10_000;

async function waitForOutcome(page: Page, baseline: number, timeoutMs: number): Promise<CompileOutcome> {
  const outcome = await pollUntil(
    async () => {
      const { entries, problems } = await readConsole(page);
      const analysed = analyzeCompile(freshEntries(entries, baseline), problems);
      return analysed.finished ? analysed : null;
    },
    { timeoutMs, intervalMs: 300 },
  );
  if (!outcome) {
    const { entries } = await readConsole(page);
    throw new TvError('TIMEOUT_COMPILE', `Compile did not finish within ${timeoutMs} ms`, {
      lastConsole: entries.slice(-5).map((entry) => entry.message),
    });
  }
  return outcome;
}

const ERROR_ROW_POLL_MS = 4000;
const ERROR_ROW_INTERVAL_MS = 300;

// A failed compile makes TradingView add a placeholder legend row; remove only rows it just created.
async function cleanupNewErrorRows(page: Page, rowsBefore: readonly LegendRow[]): Promise<number> {
  const found = await pollUntil(
    async () => {
      const ids = findNewCompileErrorRows(rowsBefore, await listLegendRows(page));
      return ids.length > 0 ? ids : null;
    },
    { timeoutMs: ERROR_ROW_POLL_MS, intervalMs: ERROR_ROW_INTERVAL_MS },
  ).catch(() => null);
  let cleaned = 0;
  for (const id of found ?? []) {
    try {
      if ((await removeLegendRow(page, id)).removed) cleaned += 1;
    } catch {
      // A failed removal must not mask the compile result.
    }
  }
  return cleaned;
}

type ReportParts = Pick<CompileReport, 'action' | 'ownedEntityId'> &
  Partial<Omit<CompileReport, 'action' | 'ownedEntityId' | 'elapsedMs'>>;

function buildReport(parts: ReportParts, startedAt: number): CompileReport {
  return {
    errors: [],
    warnings: [],
    runtimeError: { present: false },
    runtimeChecked: false,
    cleanedErrorRows: 0,
    unchanged: false,
    ...parts,
    elapsedMs: Date.now() - startedAt,
  };
}

// A freshly added row can take a moment to appear in the legend, so look for it with a bounded poll.
async function findOwnedRow(
  page: Page,
  rowsBefore: readonly LegendRow[],
  args: CompileArgs,
  action: 'added' | 'updated' | null,
): Promise<string | null> {
  const { scriptTitles, previousOwned } = args;
  if (scriptTitles.length === 0) return null; // nothing could match: do not wait
  return pollUntil(
    async () => pickOwnedEntity({ before: rowsBefore, after: await listLegendRows(page), scriptTitles, previousOwned, action }),
    { timeoutMs: OWNED_ROW_TIMEOUT_MS, intervalMs: 250 },
  );
}

const OWNED_ROW_PICKS = 3;

// The first add shows a transient legend row that TradingView replaces after ~0.6 s with the real one
// (new entity id): when the picked row disappears, pick again (bounded).
async function settleOwnedRow(
  page: Page,
  rowsBefore: readonly LegendRow[],
  args: CompileArgs,
  action: 'added' | 'updated' | null,
): Promise<{ owned: string | null; status: RowSettleResult | null }> {
  const timeoutMs = args.runtimeTimeoutMs ?? RUNTIME_SETTLE_TIMEOUT_MS;
  for (let pick = 0; pick < OWNED_ROW_PICKS; pick += 1) {
    const owned = await findOwnedRow(page, rowsBefore, args, action);
    if (!owned) return { owned: null, status: null };
    const status = await waitForRowSettled(page, owned, timeoutMs);
    if (status.present) return { owned, status };
  }
  return { owned: null, status: null };
}

export async function compileAndCollect(page: Page, args: CompileArgs): Promise<CompileReport> {
  const startedAt = Date.now();
  const baseline = (await readConsole(page)).entries.length;
  const rowsBefore = await listLegendRows(page);
  if (!(await triggerCompile(page))) {
    // Keep the previous id only while it is still on the chart under the script title (e.g. after a reload).
    const { scriptTitles, previousOwned } = args;
    const ownedEntityId = pickOwnedEntity({ before: rowsBefore, after: rowsBefore, scriptTitles, previousOwned, action: null });
    return buildReport({ action: null, ownedEntityId, unchanged: true }, startedAt);
  }
  const outcome = await waitForOutcome(page, baseline, args.timeoutMs ?? 15_000);
  if (outcome.errors.length > 0) {
    const cleanedErrorRows = await cleanupNewErrorRows(page, rowsBefore);
    const { action, errors, warnings } = outcome;
    // A failed compile may carry a new title, so only presence is checked here.
    const ownedEntityId = retainPresentOwned(args.previousOwned, rowsBefore);
    return buildReport({ action, errors, warnings, ownedEntityId, cleanedErrorRows }, startedAt);
  }
  const { owned, status } = await settleOwnedRow(page, rowsBefore, args, outcome.action);
  return buildReport(
    {
      action: outcome.action,
      warnings: outcome.warnings,
      // Not settled: a badge already shown is still reported, but runtimeChecked stays false.
      runtimeError: parseRuntimeStatus(status?.title ?? null),
      runtimeChecked: status?.settled === true,
      ownedEntityId: owned,
    },
    startedAt,
  );
}
