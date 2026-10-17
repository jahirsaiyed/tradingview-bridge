import { normalizeSource } from '../parsers/source.js';

/** How many texts the bridge pasted it remembers (oldest dropped first). */
export const MAX_KNOWN_TEXTS = 20;

const INDICATOR_TEMPLATE = ['indicator("My script")', 'plot(close)'];
const STRATEGY_TEMPLATE_PREFIX = 'strategy("My strategy"';

/** Trimmed lines that are neither blank nor comment-only (license header, //@version=N). */
function codeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));
}

function isPristineTemplate(lines: readonly string[]): boolean {
  if (lines.length === 1) return lines[0]!.startsWith(STRATEGY_TEMPLATE_PREFIX);
  return lines.length === 2 && INDICATOR_TEMPLATE.every((line) => lines.includes(line));
}

/**
 * True when replacing the editor contents cannot destroy a script the bridge did not write: the
 * editor is empty, holds a text the bridge pasted in this session, or holds TradingView's pristine
 * new-script template. Everything else (any other code) is NOT safe.
 */
export function isSafeToOverwrite(current: string, knownTexts: ReadonlySet<string>): boolean {
  const text = normalizeSource(current);
  if (text.trim() === '' || knownTexts.has(text)) return true;
  return isPristineTemplate(codeLines(text));
}

/** Returns a new list with the normalized text last, without duplicates, capped at MAX_KNOWN_TEXTS. */
export function rememberText(known: readonly string[], text: string): string[] {
  const normalized = normalizeSource(text);
  return [...known.filter((entry) => entry !== normalized), normalized].slice(-MAX_KNOWN_TEXTS);
}
