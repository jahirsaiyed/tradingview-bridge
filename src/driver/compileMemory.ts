import type { CompileProblem } from '../parsers/console.js';
import { TvError } from '../result.js';
import { deriveCompiled } from './compileState.js';

/** The outcome of the last real compile, for the source that was compiled. */
export interface CompileMemory {
  readonly source: string;
  readonly compiled: boolean;
  readonly errors: readonly CompileProblem[];
}

export interface CompileFacts {
  readonly unchanged: boolean;
  readonly errors: readonly CompileProblem[];
  readonly action: 'added' | 'updated' | null;
  /** The owned legend row found on the chart for this script, if any. */
  readonly ownedEntityId: string | null;
}

export interface CompiledResult {
  readonly compiled: boolean;
  readonly errors: readonly CompileProblem[];
  /** Present (true) when the source was unchanged and nothing shows whether it ever compiled. */
  readonly unknownState?: true;
}

/**
 * The owned row after compileAndCollect threw. A deadline TIMEOUT_COMPILE raised after the compile ran names
 * the row it found (or null, as a finished compile would); any other error leaves ownership as it was.
 */
export function ownedAfterCompileError(error: unknown, current: string | null): string | null {
  if (!(error instanceof TvError) || error.code !== 'TIMEOUT_COMPILE') return current;
  const details = error.details ?? {};
  if (details.reason !== 'deadline' || !('ownedEntityId' in details)) return current;
  const owned = details.ownedEntityId;
  return typeof owned === 'string' ? owned : null;
}

/** Keeps the memory only while it still describes the given source. */
export function memoryForSource(memory: CompileMemory | null, source: string): CompileMemory | null {
  return memory !== null && memory.source === source ? memory : null;
}

/**
 * compiled for a fresh compile: no errors and the script was applied. For an unchanged source (nothing was
 * compiled) the remembered outcome for that exact source decides, so an unchanged retry of broken source
 * never reads as success; without one, it counts as compiled only when an owned row is on the chart.
 */
export function resolveCompiled(
  memory: CompileMemory | null,
  source: string,
  facts: CompileFacts,
): { result: CompiledResult; next: CompileMemory | null } {
  if (!facts.unchanged) {
    const compiled = deriveCompiled(facts);
    return { result: { compiled, errors: facts.errors }, next: { source, compiled, errors: facts.errors } };
  }
  const known = memoryForSource(memory, source);
  if (known) return { result: { compiled: known.compiled, errors: known.errors }, next: known };
  if (facts.ownedEntityId !== null) return { result: { compiled: true, errors: [] }, next: null };
  return { result: { compiled: false, errors: [], unknownState: true }, next: null };
}
