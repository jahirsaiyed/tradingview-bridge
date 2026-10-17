import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { readConsole, triggerCompile } from './editor.js';
import { freshEntries } from './compileState.js';
import { findNewCompileErrorRows } from './errorRows.js';
import { listLegendRows, removeLegendRow } from './legend.js';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from './ownership.js';
import { settleOwned } from './ownedSettle.js';
import { waitForRowSettled, type RowSettleResult } from './rowSettle.js';
import { DEFAULT_SETTLE_RULE } from './statusSettle.js';
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

// Picks the owned row and waits until it settled, re-picking a row TradingView replaced (see settleOwned).
async function settleOwnedRow(
  page: Page,
  rowsBefore: readonly LegendRow[],
  args: CompileArgs,
  triggered: { readonly at: number; readonly action: 'added' | 'updated' | null },
): Promise<{ owned: string | null; status: RowSettleResult | null }> {
  const timeoutMs = args.runtimeTimeoutMs ?? RUNTIME_SETTLE_TIMEOUT_MS;
  return settleOwned({
    find: () => findOwnedRow(page, rowsBefore, args, triggered.action),
    settle: (id) => waitForRowSettled(page, id, timeoutMs, DEFAULT_SETTLE_RULE, triggered.at),
    isPresent: async (id) => (await listLegendRows(page)).some((row) => row.entityId === id),
  });
}

// Unchanged source: nothing recompiles, but a slow script may have raised its runtime error since the last
// read, so the owned row's status is read again once it is not loading.
async function unchangedReport(page: Page, rowsBefore: readonly LegendRow[], args: CompileArgs, startedAt: number): Promise<CompileReport> {
  const { scriptTitles, previousOwned } = args;
  // Keep the previous id only while it is still on the chart under the script title (e.g. after a reload).
  const ownedEntityId = pickOwnedEntity({ before: rowsBefore, after: rowsBefore, scriptTitles, previousOwned, action: null });
  const status = ownedEntityId ? await waitForRowSettled(page, ownedEntityId, args.runtimeTimeoutMs ?? RUNTIME_SETTLE_TIMEOUT_MS) : null;
  const runtimeChecked = status?.settled === true;
  const runtimeError = runtimeChecked ? parseRuntimeStatus(status?.title ?? null) : { present: false };
  return buildReport({ action: null, ownedEntityId, unchanged: true, runtimeError, runtimeChecked }, startedAt);
}

export async function compileAndCollect(page: Page, args: CompileArgs): Promise<CompileReport> {
  const startedAt = Date.now();
  const baseline = (await readConsole(page)).entries.length;
  const rowsBefore = await listLegendRows(page);
  const triggeredAt = Date.now();
  if (!(await triggerCompile(page))) return unchangedReport(page, rowsBefore, args, startedAt);
  const outcome = await waitForOutcome(page, baseline, args.timeoutMs ?? 15_000);
  if (outcome.errors.length > 0) {
    const cleanedErrorRows = await cleanupNewErrorRows(page, rowsBefore);
    const { action, errors, warnings } = outcome;
    // A failed compile may carry a new title, so only presence is checked here.
    const ownedEntityId = retainPresentOwned(args.previousOwned, rowsBefore);
    return buildReport({ action, errors, warnings, ownedEntityId, cleanedErrorRows }, startedAt);
  }
  const { owned, status } = await settleOwnedRow(page, rowsBefore, args, { at: triggeredAt, action: outcome.action });
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
