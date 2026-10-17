import { describe, it, expect } from 'vitest';
import { resolveCdpEndpoint, DEFAULT_CDP_ENDPOINT } from '../src/config.js';
import { TvError } from '../src/result.js';

describe('resolveCdpEndpoint', () => {
  it('defaults to loopback 9222', () => {
    expect(resolveCdpEndpoint({})).toBe(DEFAULT_CDP_ENDPOINT);
  });

  it('accepts a custom loopback port', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://localhost:9333' })).toBe('http://localhost:9333');
  });

  it('accepts IPv6 loopback', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://[::1]:9222' })).toBe('http://[::1]:9222');
  });

  it('strips any path from the endpoint', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://127.0.0.1:9222/json/version' })).toBe(
      'http://127.0.0.1:9222',
    );
  });

  it('rejects a non-loopback host', () => {
    expect(() => resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://192.168.1.5:9222' })).toThrowError(TvError);
  });

  it('rejects an invalid URL', () => {
    expect(() => resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'not a url' })).toThrowError(/not a valid URL/);
  });
});
