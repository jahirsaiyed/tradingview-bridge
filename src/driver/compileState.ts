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
