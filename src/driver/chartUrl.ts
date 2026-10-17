import { TvError } from '../result.js';

const HOST = 'tradingview.com';

/** True only for an https TradingView chart page (exact host or a subdomain, path /chart or /chart/...). */
export function isTradingViewChartUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hostOk = parsed.hostname === HOST || parsed.hostname.endsWith(`.${HOST}`);
  const pathOk = parsed.pathname === '/chart' || parsed.pathname.startsWith('/chart/');
  return parsed.protocol === 'https:' && hostOk && pathOk;
}

export function assertTradingViewChartUrl(url: string): void {
  if (!isTradingViewChartUrl(url)) {
    // The URL itself is not echoed: a non-chart tab could hold anything.
    throw new TvError('NO_CHART', 'The controlled tab is not a TradingView chart page (https://*.tradingview.com/chart)');
  }
}
