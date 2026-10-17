import { describe, it, expect } from 'vitest';
import { TvError, toFailure, toResult } from '../src/result.js';

describe('result helpers', () => {
  it('maps TvError to a failure with code, message and details', () => {
    const failure = toFailure(new TvError('NO_CHART', 'no chart', { url: 'x' }));
    expect(failure).toEqual({
      ok: false,
      error: { code: 'NO_CHART', message: 'no chart', details: { url: 'x' } },
    });
  });

  it('omits details when the TvError has none', () => {
    const failure = toFailure(new TvError('NOT_CONNECTED', 'down'));
    expect(failure).toEqual({ ok: false, error: { code: 'NOT_CONNECTED', message: 'down' } });
  });

  it('maps unknown Errors to INTERNAL', () => {
    expect(toFailure(new Error('boom'))).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'boom' },
    });
  });

  it('maps non-Error throwables to INTERNAL with a string message', () => {
    expect(toFailure('oops')).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'oops' } });
  });

  it('toResult spreads the data after ok:true', async () => {
    expect(await toResult(async () => ({ a: 1 }))).toEqual({ ok: true, a: 1 });
  });

  it('toResult converts a thrown TvError into a failure', async () => {
    const result = await toResult(async () => {
      throw new TvError('TIMEOUT_REPORT', 'slow');
    });
    expect(result).toEqual({ ok: false, error: { code: 'TIMEOUT_REPORT', message: 'slow' } });
  });
});
