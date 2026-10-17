import { normalizeText } from './numbers.js';

export interface RuntimeError {
  readonly present: boolean;
  readonly code?: string;
  readonly raw?: string;
}

const RUNTIME_ERROR = /^Runtime error:\s*([A-Z]{2}\d+)/;

export function parseRuntimeStatus(title: string | null | undefined): RuntimeError {
  if (!title) return { present: false };
  const match = RUNTIME_ERROR.exec(normalizeText(title));
  if (!match) return { present: false, raw: title };
  return { present: true, code: match[1]!, raw: title };
}
