const TITLE = /session\s+disconnected/i;
const OTHER_DEVICE = /accessed\s+from\s+another\s+browser\s+or\s+device/i;

/**
 * True when the page text shows TradingView's full-page "Session disconnected" modal (the account was
 * opened on another browser or device; only one session is allowed). Needs both phrases.
 */
export function isSessionDisconnectedText(bodyText: string): boolean {
  return TITLE.test(bodyText) && OTHER_DEVICE.test(bodyText);
}
