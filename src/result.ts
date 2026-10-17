export const ERROR_CODES = [
  'NOT_CONNECTED',
  'NOT_LOGGED_IN',
  'NO_CHART',
  'UNEXPECTED_DIALOG',
  'LAYOUT_FAILED',
  'TIMEOUT_COMPILE',
  'TIMEOUT_REPORT',
  'SELECTOR_MISSING',
  'PASTE_MISMATCH',
  'NOT_OWNED',
  'INVALID_ARGUMENT',
  'REMOVE_FAILED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class TvError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TvError';
    this.code = code;
    this.details = details;
  }
}

export interface ErrorInfo {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type Failure = { readonly ok: false; readonly error: ErrorInfo };
export type Success<T extends object> = { readonly ok: true } & T;
export type ToolResult<T extends object> = Success<T> | Failure;

export function toFailure(error: unknown): Failure {
  if (error instanceof TvError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: 'INTERNAL', message } };
}

export async function toResult<T extends object>(fn: () => Promise<T>): Promise<ToolResult<T>> {
  try {
    const data = await fn();
    return { ok: true, ...data };
  } catch (error) {
    return toFailure(error);
  }
}
