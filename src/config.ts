import { TvError } from './result.js';

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export function resolveCdpEndpoint(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.TV_CDP_ENDPOINT ?? DEFAULT_CDP_ENDPOINT;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TvError('INVALID_ARGUMENT', `TV_CDP_ENDPOINT is not a valid URL: ${raw}`);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new TvError('INVALID_ARGUMENT', `CDP endpoint scheme must be http: or https:, got ${url.protocol}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TvError(
      'INVALID_ARGUMENT',
      `CDP endpoint must be loopback (127.0.0.1, localhost or [::1]), got ${url.hostname}`,
    );
  }
  return `${url.protocol}//${url.host}`;
}
