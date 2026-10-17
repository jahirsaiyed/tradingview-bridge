import { normalizeText } from './numbers.js';

export interface PineLogLine {
  readonly time: string;
  readonly text: string;
}

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]:\s?(.*)$/;

export function parsePineLogs(lines: readonly string[]): PineLogLine[] {
  const parsed: PineLogLine[] = [];
  for (const line of lines) {
    const match = LOG_LINE.exec(normalizeText(line));
    if (match) parsed.push({ time: match[1]!, text: match[2]! });
  }
  return parsed;
}
