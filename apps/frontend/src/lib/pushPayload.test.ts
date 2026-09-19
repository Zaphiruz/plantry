import { describe, expect, it } from 'vitest';
import { parsePushPayload } from './pushPayload';

describe('parsePushPayload', () => {
  it('parses a valid payload as-is', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'Low stock', body: '3 items', url: '/h/h1/shopping' })))
      .toEqual({ title: 'Low stock', body: '3 items', url: '/h/h1/shopping' });
  });

  it('falls back entirely for null / non-JSON text', () => {
    const fallback = { title: 'Plantry', body: '', url: '/' };
    expect(parsePushPayload(null)).toEqual(fallback);
    expect(parsePushPayload('not json')).toEqual(fallback);
    expect(parsePushPayload('{broken')).toEqual(fallback);
  });

  it('falls back for a JSON value that is not an object', () => {
    expect(parsePushPayload('42')).toEqual({ title: 'Plantry', body: '', url: '/' });
    expect(parsePushPayload('"hello"')).toEqual({ title: 'Plantry', body: '', url: '/' });
    expect(parsePushPayload('null')).toEqual({ title: 'Plantry', body: '', url: '/' });
  });

  it('fills in defaults field-by-field for {} and wrong-typed fields', () => {
    expect(parsePushPayload('{}')).toEqual({ title: 'Plantry', body: '', url: '/' });
    expect(parsePushPayload(JSON.stringify({ title: 123, body: false, url: 5 })))
      .toEqual({ title: 'Plantry', body: '', url: '/' });
    expect(parsePushPayload(JSON.stringify({ title: '' }))).toEqual({ title: 'Plantry', body: '', url: '/' });
  });

  it('rejects an absolute, protocol-relative, or javascript: url and falls back to "/"', () => {
    expect(parsePushPayload(JSON.stringify({ url: 'https://evil.example/phish' })).url).toBe('/');
    expect(parsePushPayload(JSON.stringify({ url: '//evil.example/phish' })).url).toBe('/');
    expect(parsePushPayload(JSON.stringify({ url: 'javascript:alert(1)' })).url).toBe('/');
  });

  it('accepts a same-origin absolute path', () => {
    expect(parsePushPayload(JSON.stringify({ url: '/h/h1/items/i1' })).url).toBe('/h/h1/items/i1');
  });
});
