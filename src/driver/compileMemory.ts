import type { CompileProblem } from '../parsers/console.js';
import { TvError } from '../result.js';
import { deriveCompiled } from './compileState.js';
import { isCompileErrorStatus } from './errorRows.js';
import { titleMatches, type LegendRow } from './ownership.js';

/**
 * The outcome of the last REAL compile, keyed by the exact source that was compiled. TradingView answers an
 * unchanged source only when it equals its own last compile, so one slot is enough. `unknown` marks a source
 * whose compile was triggered but threw before its outcome was read.
 */
export interface CompileMemory {
  readonly source: string;
  readonly compiled: boolean;
  readonly errors: readonly CompileProblem[];
  readonly unknown?: true;
}

export interface CompileFacts {
  readonly unchanged: boolean;
  readonly errors: readonly CompileProblem[];
  readonly action: 'added' | 'updated' | null;
  /** The owned legend row found on the chart for this script, if any. */
  readonly ownedEntityId: string | null;
  /** That row's status title (e.g. "Compilation error: CE10156 ..."), null when none was shown. */
  readonly ownedStatus?: string | null;
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

export type MemoryEvent =
  | { readonly kind: 'setScript' }
  | { readonly kind: 'openChart' | 'removeScript' | 'recovery' }
  | { readonly kind: 'compileError'; readonly source: string; readonly triggered: boolean };

/**
 * The clearing rules. Setting a different source keeps the memory (lookups are keyed by source). A reload,
 * a removal or the stall recovery clears it. A compile error raised before the compile was triggered changes
 * nothing; after the trigger, the same source keeps its evidence and a different source becomes UNKNOWN.
 */
export function nextMemory(memory: CompileMemory | null, event: MemoryEvent): CompileMemory | null {
  if (event.kind === 'setScript') return memory;
  if (event.kind !== 'compileError') return null;
  if (!event.triggered || memory?.source === event.source) return memory;
  return { source: event.source, compiled: false, errors: [], unknown: true };
}

/**
 * compiled for a fresh compile: no errors and the script was applied. For an unchanged source (nothing was
 * compiled) the remembered outcome for that exact source decides, so an unchanged retry of broken source
 * never reads as success. Without a trusted one it counts as compiled only when an owned row is on the
 * chart and that row does not show a compilation error.
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
  if (known && known.unknown !== true) return { result: { compiled: known.compiled, errors: known.errors }, next: known };
  if (facts.ownedEntityId !== null && !isCompileErrorStatus(facts.ownedStatus)) {
    return { result: { compiled: true, errors: [] }, next: known };
  }
  return { result: { compiled: false, errors: [], unknownState: true }, next: known };
}

/**
 * Whether the stall recovery's re-compile lets the report read go on. An unknown state (unchanged source and
 * no remembered outcome, e.g. the reloaded row got a new entity id) is accepted only while a legend row
 * matching the script names is on the chart. Ownership is never taken by title here: the compile result's
 * normal fresh/owned rules decide it, and the report identity check still guards the numbers.
 */
export function recoveryCompileAccepted(
  result: CompiledResult,
  rows: readonly LegendRow[],
  names: readonly string[],
): boolean {
  if (result.compiled) return true;
  if (result.unknownState !== true || result.errors.length > 0) return false;
  const wanted = names.filter((name) => name.length > 0);
  return rows.some((row) => wanted.some((name) => titleMatches(row.title, name)));
}