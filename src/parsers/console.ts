import { normalizeText } from './numbers.js';

export interface ConsoleEntry {
  readonly time: string;
  readonly message: string;
}
export interface ProblemCode {
  readonly message: string;
  readonly code: string;
}
export interface CompileProblem {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: string;
}
export interface CompileOutcome {
  readonly finished: boolean;
  readonly compiled: boolean;
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  /** TradingView did not recompile: the text equals its last compile (live-verified 2026-10-17). */
  readonly nothingToUpdate: boolean;
}

/**
 * Printed instead of compiling when the editor text equals the last compile, even a failed one, while the
 * apply button is still enabled (seen when an earlier run left a failed compile of the same text).
 */
const NOTHING_TO_UPDATE = 'There is nothing to update.';
const CONSOLE_LINE = /^(\d{1,2}:\d{2}:\d{2}(?: [AP]M)?) (.+)$/; // 12- or 24-hour clock
const PROBLEM_CODE_LINE = /^(.*)\(([A-Z]{2}\d{4,6})\)$/;
const ERROR_ENTRY = /^Error at (\d+):(\d+) (.*)$/;
const WARNING_ENTRY = /^Warning at (\d+):(\d+) (.*)$/; // format assumed; not yet observed live

export function parseConsoleEntries(panelText: string): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const line of panelText.split('\n')) {
    const match = CONSOLE_LINE.exec(normalizeText(line));
    if (match) entries.push({ time: match[1]!, message: match[2]! });
  }
  return entries;
}

export function parseProblemCodes(panelText: string): ProblemCode[] {
  const codes: ProblemCode[] = [];
  for (const line of panelText.split('\n')) {
    const match = PROBLEM_CODE_LINE.exec(normalizeText(line));
    if (match && match[1]!.trim()) codes.push({ message: match[1]!.trim(), code: match[2]! });
  }
  return codes;
}

function toProblem(match: RegExpExecArray, codes: readonly ProblemCode[]): CompileProblem {
  const message = match[3]!;
  const code = codes.find((c) => c.message === message)?.code;
  return { line: Number(match[1]), column: Number(match[2]), message, ...(code ? { code } : {}) };
}

function collect(messages: readonly string[], pattern: RegExp, codes: readonly ProblemCode[]): CompileProblem[] {
  return messages
    .map((m) => pattern.exec(m))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => toProblem(m, codes));
}

export function analyzeCompile(
  entries: readonly ConsoleEntry[],
  codes: readonly ProblemCode[] = [],
): CompileOutcome {
  const messages = entries.map((e) => e.message);
  const errors = collect(messages, ERROR_ENTRY, codes);
  const warnings = collect(messages, WARNING_ENTRY, codes);
  const compiled = messages.includes('Compiled.');
  const action = messages.includes('Added to chart.')
    ? 'added'
    : messages.includes('Updated on chart.')
      ? 'updated'
      : null;
  const nothingToUpdate = messages.includes(NOTHING_TO_UPDATE);
  const finished = errors.length > 0 || (compiled && action !== null) || nothingToUpdate;
  return { finished, compiled, action, errors, warnings, nothingToUpdate };
}
