import { describe, expect, it } from 'vitest';
import { loggerOptions, serializeRequest } from './logging.js';

describe('request log serializer', () => {
  it('logs the path only, never the query string', () => {
    const out = serializeRequest({
      method: 'GET',
      url: '/api/auth/callback?code=super-secret&state=abc',
      ip: '10.1.2.3',
    });
    expect(out).toEqual({ method: 'GET', url: '/api/auth/callback', remoteAddress: '10.1.2.3' });
    expect(JSON.stringify(out)).not.toContain('super-secret');
  });

  it('handles a url with no query string and a missing ip', () => {
    expect(serializeRequest({ method: 'POST', url: '/api/households' }))
      .toEqual({ method: 'POST', url: '/api/households', remoteAddress: undefined });
  });

  it('handles a hash-only or malformed url without throwing', () => {
    expect(serializeRequest({ method: 'GET', url: '/a#b?c=d', ip: '::1' }).url).toBe('/a');
    expect(serializeRequest({ method: 'GET', url: '', ip: '::1' }).url).toBe('');
  });

  it('removes the cookie and authorization headers', () => {
    expect(loggerOptions.redact).toEqual({
      paths: ['req.headers.cookie', 'req.headers.authorization'],
      remove: true,
    });
    expect(loggerOptions.serializers?.req).toBe(serializeRequest);
  });
});
