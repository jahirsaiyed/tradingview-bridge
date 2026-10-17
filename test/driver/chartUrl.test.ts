import { describe, it, expect } from 'vitest';
import { assertTradingViewChartUrl, isTradingViewChartUrl } from '../../src/driver/chartUrl.js';
import { TvError } from '../../src/result.js';

describe('isTradingViewChartUrl', () => {
  it.each([
    'https://www.tradingview.com/chart/ABC123/?symbol=X',
    'https://tradingview.com/chart/',
    'https://in.tradingview.com/chart',
  ])('accepts %s', (url) => {
    expect(isTradingViewChartUrl(url)).toBe(true);
  });

  it.each([
    'http://www.tradingview.com/chart/',
    'https://evil.example/?q=tradingview.com/chart',
    'https://tradingview.com.evil.example/chart/',
    'https://eviltradingview.com/chart/',
    'https://www.tradingview.com/symbols/X',
    'https://www.tradingview.com/',
    'not a url',
    '',
    'about:blank',
  ])('rejects %s', (url) => {
    expect(isTradingViewChartUrl(url)).toBe(false);
  });
});

describe('assertTradingViewChartUrl', () => {
  it('passes a chart URL through', () => {
    expect(() => assertTradingViewChartUrl('https://www.tradingview.com/chart/x/')).not.toThrow();
  });

  it('throws NO_CHART for anything else', () => {
    try {
      assertTradingViewChartUrl('https://evil.example/chart/');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TvError);
      expect((error as TvError).code).toBe('NO_CHART');
    }
  });
});
