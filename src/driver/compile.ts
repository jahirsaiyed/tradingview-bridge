import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { triggerCompile } from './editor.js';
import { ensureConsoleOpen, readConsole, type OpenOptions } from './consolePane.js';
import { freshEntries, routeOutcome } from './compileState.js';
import { findNewCompileErrorRows } from './errorRows.js';
import { listLegendRows, removeLegendRow } from './legend.js';
import { pickOwnedEntity, retainPresentOwned, type LegendRow } from './ownership.js';
import { settleOwned } from './ownedSettle.js';
import { waitForRowSettled, type RowSettleResult } from './rowSettle.js';
import { DEFAULT_SETTLE_RULE } from './statusSettle.js';
import { capMs, createDeadline, deadlineError, type Deadline } from './deadline.js';
import { pollUntil } from './waits.js';

export interface CompileReport {
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  /** True when an owned legend row was found, stopped calculating and its status was read. */
  readonly runtimeChecked: boolean;
  readonly ownedEntityId: string | null;
  /** Status title of the owned row when it was read (e.g. "Compilation error: ..."); null when none. */
  readonly ownedStatus: string | null;
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
  /** Shared budget of the whole tool call; a fresh COMPILE_DEADLINE_MS one when absent. */
  readonly deadline?: Deadline;
  /** Called right before Ctrl+Enter is pressed: from then on a failure leaves the outcome unknown. */
  readonly onTriggered?: () => void;
}

const OUTCOME_TIMEOUT_MS = 15_000;
const OWNED_ROW_TIMEOUT_MS = 5000;
const RUNTIME_SETTLE_TIMEOUT_MS = 10_000;
/**
 * Shared budget of one tv_compile call (outcome 15 s + up to 3 x (owned row 5 s + settle 10 s) would be 60 s).
 * Once it is used up the call fails with TIMEOUT_COMPILE (details.reason 'deadline', details.phase).
 */
export const COMPILE_DEADLINE_MS = 45_000;
/**
 * Time that must be left before Ctrl+Enter: a compile triggered without time to read its outcome and find its
 * row would leave a row nobody owns. With less, the call fails with TIMEOUT_COMPILE, phase 'before-trigger'.
 */
export const TRIGGER_RESERVE_MS = 20_000;
/** Upper bound of one Playwright action (click, hover) inside the compile phases. */
const ACTION_MAX_MS = 5000;
const CONSOLE_OPEN_MAX_MS = 3000;

type Budgeted = CompileArgs & { readonly deadline: Deadline };

/** Fails with TIMEOUT_COMPILE once the budget is used up; details carry what is already known. */
function checkBudget(args: Budgeted, phase: string, known: Record<string, unknown> = {}): void {
  if (args.deadline.expired()) throw deadlineError('TIMEOUT_COMPILE', phase, args.deadline, known);
}

// Opening a collapsed console (one click, a short wait) is capped by the time left as well.
function consoleOptions(args: Budgeted): OpenOptions {
  return { timeoutMs: capMs(args.deadline, CONSOLE_OPEN_MAX_MS), clickTimeoutMs: capMs(args.deadline, ACTION_MAX_MS) };
}

async function waitForOutcome(page: Page, baseline: number, args: Budgeted): Promise<CompileOutcome> {
  const timeoutMs = args.timeoutMs ?? OUTCOME_TIMEOUT_MS;
  checkBudget(args, 'outcome');
  const outcome = await pollUntil(
    async () => {
      const { entries, problems } = await readConsole(page, consoleOptions(args));
      const analysed = analyzeCompile(freshEntries(entries, baseline), problems);
      return analysed.finished ? analysed : null;
    },
    { timeoutMs: args.deadline.cap(timeoutMs), intervalMs: 300 },
  );
  if (!outcome) {
    const { entries } = await readConsole(page, consoleOptions(args));
    const lastConsole = entries.slice(-5).map((entry) => entry.message);
    checkBudget(args, 'outcome', { lastConsole });
    throw new TvError('TIMEOUT_COMPILE', `Compile did not finish within ${timeoutMs} ms`, { lastConsole, phase: 'outcome' });
  }
  return outcome;
}

const ERROR_ROW_POLL_MS = 4000;
const ERROR_ROW_INTERVAL_MS = 300;

// A failed compile makes TradingView add a placeholder legend row; remove only rows it just created.
async function cleanupNewErrorRows(page: Page, rowsBefore: readonly LegendRow[], deadline: Deadline): Promise<number> {
  const found = await pollUntil(
    async () => {
      const ids = findNewCompileErrorRows(rowsBefore, await listLegendRows(page));
      return ids.length > 0 ? ids : null;
    },
    { timeoutMs: deadline.cap(ERROR_ROW_POLL_MS), intervalMs: ERROR_ROW_INTERVAL_MS },
  ).catch(() => null);
  let cleaned = 0;
  for (const id of found ?? []) {
    try {
      if ((await removeLegendRow(page, id, capMs(deadline, ACTION_MAX_MS))).removed) cleaned += 1;
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
    ownedStatus: null,
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
  args: Budgeted,
  action: 'added' | 'updated' | null,
): Promise<string | null> {
  const { scriptTitles, previousOwned } = args;
  if (scriptTitles.length === 0) return null; // nothing could match: do not wait
  return pollUntil(
    async () => pickOwnedEntity({ before: rowsBefore, after: await listLegendRows(page), scriptTitles, previousOwned, action }),
    { timeoutMs: args.deadline.cap(OWNED_ROW_TIMEOUT_MS), intervalMs: 250 },
  );
}

// Picks the owned row and waits until it settled, re-picking a row TradingView replaced (see settleOwned).
// Every find and settle is capped by the shared deadline, so the re-picks cannot run past it.
async function settleOwnedRow(
  page: Page,
  rowsBefore: readonly LegendRow[],
  args: Budgeted,
  triggered: { readonly at: number; readonly action: 'added' | 'updated' | null },
): Promise<{ owned: string | null; status: RowSettleResult | null }> {
  const timeoutMs = args.runtimeTimeoutMs ?? RUNTIME_SETTLE_TIMEOUT_MS;
  const settled = await settleOwned({
    find: () => findOwnedRow(page, rowsBefore, args, triggered.action),
    settle: (id) => waitForRowSettled(page, id, args.deadline.cap(timeoutMs), DEFAULT_SETTLE_RULE, triggered.at),
    isPresent: async (id) => (await listLegendRows(page)).some((row) => row.entityId === id),
  });
  // The compile itself succeeded: details say so and name the row, so the driver keeps owning it.
  if (settled.status?.settled !== true) {
    const known = { action: triggered.action, ownedEntityId: settled.owned };
    checkBudget(args, settled.owned === null ? 'owned-row' : 'row-settle', known);
  }
  return settled;
}

// Unchanged source: nothing recompiles, but a slow script may have raised its runtime error since the last
// read, so the owned row's status is read again once it is not loading.
async function unchangedReport(page: Page, rowsBefore: readonly LegendRow[], args: Budgeted, startedAt: number): Promise<CompileReport> {
  const { scriptTitles, previousOwned } = args;
  // Keep the previous id only while it is still on the chart under the script title (e.g. after a reload).
  const ownedEntityId = pickOwnedEntity({ before: rowsBefore, after: rowsBefore, scriptTitles, previousOwned, action: null });
  const settleMs = args.deadline.cap(args.runtimeTimeoutMs ?? RUNTIME_SETTLE_TIMEOUT_MS);
  const status = ownedEntityId ? await waitForRowSettled(page, ownedEntityId, settleMs) : null;
  const runtimeChecked = status?.settled === true;
  if (ownedEntityId && !runtimeChecked) checkBudget(args, 'unchanged-settle', { unchanged: true, ownedEntityId });
  const runtimeError = runtimeChecked ? parseRuntimeStatus(status?.title ?? null) : { present: false };
  const ownedStatus = status?.title ?? rowsBefore.find((row) => row.entityId === ownedEntityId)?.status ?? null;
  return buildReport({ action: null, ownedEntityId, ownedStatus, unchanged: true, runtimeError, runtimeChecked }, startedAt);
}

// A failed compile: remove the junk legend rows it created, keep the previous owned row if still present.
async function failedReport(page: Page, rowsBefore: readonly LegendRow[], args: Budgeted, outcome: CompileOutcome, startedAt: number): Promise<CompileReport> {
  const cleanedErrorRows = await cleanupNewErrorRows(page, rowsBefore, args.deadline);
  const { action, errors, warnings } = outcome;
  // A failed compile may carry a new title, so only presence is checked here.
  const ownedEntityId = retainPresentOwned(args.previousOwned, rowsBefore);
  if (cleanedErrorRows === 0) checkBudget(args, 'error-rows', { errors, ownedEntityId });
  return buildReport({ action, errors, warnings, ownedEntityId, cleanedErrorRows }, startedAt);
}

async function appliedReport(
  page: Page,
  rowsBefore: readonly LegendRow[],
  args: Budgeted,
  outcome: CompileOutcome,
  times: { readonly triggeredAt: number; readonly startedAt: number },
): Promise<CompileReport> {
  const { owned, status } = await settleOwnedRow(page, rowsBefore, args, { at: times.triggeredAt, action: outcome.action });
  return buildReport(
    {
      action: outcome.action,
      warnings: outcome.warnings,
      // Not settled: a badge already shown is still reported, but runtimeChecked stays false.
      runtimeError: parseRuntimeStatus(status?.title ?? null),
      runtimeChecked: status?.settled === true,
      ownedEntityId: owned,
      ownedStatus: status?.title ?? null,
    },
    times.startedAt,
  );
}

/** Before Ctrl+Enter: fail without compiling when too little time is left to read the outcome. */
function checkTriggerReserve(args: Budgeted): void {
  if (args.deadline.remaining() < TRIGGER_RESERVE_MS) {
    throw deadlineError('TIMEOUT_COMPILE', 'before-trigger', args.deadline, { compiled: false });
  }
}

export async function compileAndCollect(page: Page, compileArgs: CompileArgs): Promise<CompileReport> {
  const args: Budgeted = { ...compileArgs, deadline: compileArgs.deadline ?? createDeadline(COMPILE_DEADLINE_MS) };
  const startedAt = Date.now();
  // A collapsed console (fresh layout) is opened first and left open; the baseline is read only after that.
  await ensureConsoleOpen(page, consoleOptions(args));
  const baseline = (await readConsole(page, consoleOptions(args))).entries.length;
  const rowsBefore = await listLegendRows(page);
  checkTriggerReserve(args);
  const triggeredAt = Date.now();
  const pressed = await triggerCompile(page, { actionTimeoutMs: capMs(args.deadline, ACTION_MAX_MS), onTrigger: args.onTriggered });
  if (!pressed) return unchangedReport(page, rowsBefore, args, startedAt);
  const outcome = await waitForOutcome(page, baseline, args);
  const route = routeOutcome(outcome);
  if (route === 'unchanged') return unchangedReport(page, rowsBefore, args, startedAt);
  if (route === 'failed') return failedReport(page, rowsBefore, args, outcome, startedAt);
  return appliedReport(page, rowsBefore, args, outcome, { triggeredAt, startedAt });
}
