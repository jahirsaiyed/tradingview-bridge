import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { readConsole, triggerCompile } from './editor.js';
import { freshEntries } from './compileState.js';
import { findNewCompileErrorRows } from './errorRows.js';
import { listLegendRows, readStatusTitle, removeLegendRow } from './legend.js';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from './ownership.js';
import { pollUntil, realSleep } from './waits.js';

export interface CompileReport {
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  /** True when an owned legend row was found and its status was read. */
  readonly runtimeChecked: boolean;
  readonly ownedEntityId: string | null;
  /** Junk legend rows this compile created (failed compiles) and removed. */
  readonly cleanedErrorRows: number;
  /** True when the source matched the last compiled version, so nothing was compiled. */
  readonly unchanged: boolean;
  readonly elapsedMs: number;
}

const STATUS_READS = 3;
const STATUS_INTERVAL_MS = 500;

async function readStableStatus(page: Page, entityId: string): Promise<string | null> {
  let last = await readStatusTitle(page, entityId);
  for (let i = 1; i < STATUS_READS; i += 1) {
    await realSleep(STATUS_INTERVAL_MS);
    const next = await readStatusTitle(page, entityId);
    const stable = next === last;
    last = next;
    if (stable) break;
  }
  return last;
}

export interface CompileArgs {
  readonly previousOwned: string | null;
  /** Declared script names (title and/or short title); empty when unknown. */
  readonly scriptTitles: readonly string[];
  readonly timeoutMs?: number;
  readonly settleMs?: number;
}

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
  await realSleep(args.settleMs ?? 2500);
  const owned = pickOwnedEntity({
    before: rowsBefore,
    after: await listLegendRows(page),
    scriptTitles: args.scriptTitles,
    previousOwned: args.previousOwned,
    action: outcome.action,
  });
  const statusTitle = owned ? await readStableStatus(page, owned) : null;
  return buildReport(
    {
      action: outcome.action,
      warnings: outcome.warnings,
      runtimeError: parseRuntimeStatus(statusTitle),
      runtimeChecked: owned !== null,
      ownedEntityId: owned,
    },
    startedAt,
  );
}
