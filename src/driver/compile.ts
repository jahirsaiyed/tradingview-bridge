import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { readConsole, triggerCompile } from './editor.js';
import { listLegendRows, readStatusTitle } from './legend.js';
import { pickOwnedEntity } from './ownership.js';
import { pollUntil, realSleep } from './waits.js';

export interface CompileReport {
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  readonly ownedEntityId: string | null;
  readonly elapsedMs: number;
}

export interface CompileArgs {
  readonly previousOwned: string | null;
  readonly scriptTitle: string | null;
  readonly timeoutMs?: number;
  readonly settleMs?: number;
}

async function waitForOutcome(page: Page, baseline: number, timeoutMs: number): Promise<CompileOutcome> {
  const outcome = await pollUntil(
    async () => {
      const { entries, problems } = await readConsole(page);
      // If the console was cleared (fewer entries than the baseline), treat all entries as new.
      const fresh = entries.length >= baseline ? entries.slice(baseline) : entries;
      const analysed = analyzeCompile(fresh, problems);
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

export async function compileAndCollect(page: Page, args: CompileArgs): Promise<CompileReport> {
  const startedAt = Date.now();
  const baseline = (await readConsole(page)).entries.length;
  const rowsBefore = await listLegendRows(page);
  await triggerCompile(page);
  const outcome = await waitForOutcome(page, baseline, args.timeoutMs ?? 15_000);
  if (outcome.errors.length > 0) {
    return {
      action: outcome.action,
      errors: outcome.errors,
      warnings: outcome.warnings,
      runtimeError: { present: false },
      ownedEntityId: args.previousOwned,
      elapsedMs: Date.now() - startedAt,
    };
  }
  await realSleep(args.settleMs ?? 2500);
  const owned = pickOwnedEntity({
    before: rowsBefore,
    after: await listLegendRows(page),
    scriptTitle: args.scriptTitle,
    previousOwned: args.previousOwned,
    action: outcome.action,
  });
  const statusTitle = owned ? await readStatusTitle(page, owned) : null;
  return {
    action: outcome.action,
    errors: [],
    warnings: outcome.warnings,
    runtimeError: parseRuntimeStatus(statusTitle),
    ownedEntityId: owned,
    elapsedMs: Date.now() - startedAt,
  };
}
