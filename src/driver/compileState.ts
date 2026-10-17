import type { CompileProblem, ConsoleEntry } from '../parsers/console.js';

/**
 * Console entries logged after the baseline count taken before the compile. If the console was
 * cleared (fewer entries than the baseline), every entry is treated as new.
 */
export function freshEntries(entries: readonly ConsoleEntry[], baseline: number): readonly ConsoleEntry[] {
  return entries.length >= baseline ? entries.slice(baseline) : entries;
}

export interface CompiledInput {
  readonly unchanged: boolean;
  readonly errors: readonly CompileProblem[];
  readonly action: 'added' | 'updated' | null;
}

/** compiled = the source already matched the chart, or it compiled without errors and was applied. */
export function deriveCompiled(report: CompiledInput): boolean {
  return report.unchanged || (report.errors.length === 0 && report.action !== null);
}
