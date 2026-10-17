import { describe, it, expect } from 'vitest';
import { parseChartLabel } from '../../src/parsers/chart.js';

describe('parseChartLabel', () => {
  it('splits symbol and interval', () => {
    expect(parseChartLabel('Chart for FX_IDC:EURUSD, 1 hour')).toEqual({
      symbol: 'FX_IDC:EURUSD',
      interval: '1 hour',
    });
  });
  it('returns null for unrelated labels', () => {
    expect(parseChartLabel('Something else')).toBeNull();
  });
});
