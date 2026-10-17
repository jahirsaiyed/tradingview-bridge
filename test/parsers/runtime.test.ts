import { describe, it, expect } from 'vitest';
import { parseRuntimeStatus } from '../../src/parsers/runtime.js';

describe('parseRuntimeStatus', () => {
  it('extracts the runtime error code from the legend title', () => {
    expect(parseRuntimeStatus('Runtime error: RE10045 · Opened in Pine Editor')).toEqual({
      present: true,
      code: 'RE10045',
      raw: 'Runtime error: RE10045 · Opened in Pine Editor',
    });
  });
  it('reports no error for a missing title', () => {
    expect(parseRuntimeStatus(null)).toEqual({ present: false });
    expect(parseRuntimeStatus(undefined)).toEqual({ present: false });
  });
  it('does not treat other statuses as runtime errors', () => {
    expect(parseRuntimeStatus('Some other status')).toEqual({ present: false, raw: 'Some other status' });
  });
});
