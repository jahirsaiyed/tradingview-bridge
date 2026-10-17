import { normalizeSource, sourcesEqual } from '../parsers/source.js';

/** How many texts the bridge pasted it remembers (oldest dropped first). */
export const MAX_KNOWN_TEXTS = 20;

const INDICATOR_TEMPLATE = ['indicator("My script")', 'plot(close)'];
// The exact default strategy line, or the bare declaration; nothing else.
const STRATEGY_TEMPLATE = /^strategy\("My strategy"(?:, overlay=true, margin_long=100, margin_short=100)?\)$/;
// Only the new-script license header and //@version=N are ignorable; any other comment is user content.
const IGNORABLE_COMMENTS = [
  /^\/\/@version=\d+$/,
  /^\/\/ This Pine Script\S* code is subject to the terms of the Mozilla Public License/,
  /^\/\/ (?:\(c\)|\u00a9) \S/,
];

/** Trimmed non-blank lines, without the license header and //@version=N lines. */
function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !IGNORABLE_COMMENTS.some((pattern) => pattern.test(line)));
}

function isPristineTemplate(lines: readonly string[]): boolean {
  if (lines.length === 1) return STRATEGY_TEMPLATE.test(lines[0]!);
  return lines.length === 2 && INDICATOR_TEMPLATE.every((line) => lines.includes(line));
}

/**
 * True when replacing the editor contents cannot destroy a script the bridge did not write: the
 * editor is empty, holds a text the bridge pasted in this session, or holds TradingView's pristine
 * new-script template (optional license header and //@version line). Everything else, including
 * any other comment line, is NOT safe.
 */
export function isSafeToOverwrite(current: string, knownTexts: ReadonlySet<string>): boolean {
  const text = normalizeSource(current);
  if (text.trim() === '' || knownTexts.has(text)) return true;
  return isPristineTemplate(contentLines(text));
}

/** Returns a new list with the normalized text last, without duplicates, capped at MAX_KNOWN_TEXTS. */
export function rememberText(known: readonly string[], text: string): string[] {
  const normalized = normalizeSource(text);
  return [...known.filter((entry) => entry !== normalized), normalized].slice(-MAX_KNOWN_TEXTS);
}

/**
 * Records a paste: when the read-back matches, the source is remembered; on a mismatch the read-back
 * text is remembered instead, because that is what the bridge itself left in the editor (so the next
 * setScript may replace it). Bounded-set rules are those of rememberText.
 */
export function recordPaste(known: readonly string[], source: string, readBack: string): { matched: boolean; known: string[] } {
  const matched = sourcesEqual(source, readBack);
  return { matched, known: rememberText(known, matched ? source : readBack) };
}
