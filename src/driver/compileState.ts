import type { CompileProblem, ConsoleEntry } from '../parsers/console.js';

/**
 * Console entries logged after the baseline count taken before the compile. If the console was
 * cleared (fewer entries than the baseline), every entry is treated as new.
 */
export function freshEntries(entries: readonly ConsoleEntry[], baseline: number): readonly ConsoleEntry[] {
  return entries.length >= baseline ? entries.slice(baseline) : entries;
}

export interface CompiledInput {
  readonly errors: readonly CompileProblem[];
  readonly action: 'added' | 'updated' | null;
}

/**
 * compiled for a compile that actually ran = no errors and the script was applied. An unchanged source
 * (nothing compiled) is resolved by resolveCompiled in compileMemory.ts, never here.
 */
export function deriveCompiled(report: CompiledInput): boolean {
  return report.errors.length === 0 && report.action !== null;
}

export interface RoutedOutcome {
  readonly errors: readonly CompileProblem[];
  readonly nothingToUpdate: boolean;
}

/**
 * What a finished compile outcome means: errors always fail; "There is nothing to update." without errors
 * (TradingView refused to recompile its last compiled text) is unchanged; anything else was applied.
 */
export function routeOutcome(outcome: RoutedOutcome): 'failed' | 'unchanged' | 'applied' {
  if (outcome.nothingToUpdate && outcome.errors.length === 0) return 'unchanged';
  return outcome.errors.length > 0 ? 'failed' : 'applied';
}