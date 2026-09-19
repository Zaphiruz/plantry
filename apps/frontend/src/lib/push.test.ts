import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsIosInstall, urlBase64ToUint8Array } from './push';

afterEach(() => vi.unstubAllGlobals());

describe('urlBase64ToUint8Array', () => {
  it('round-trips base64url-encoded bytes', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => i * 3 + 7);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(urlBase64ToUint8Array(b64url)).toEqual(bytes);
  });
});

function stubUserAgent(userAgent: string, platform = ''): void {
  vi.stubGlobal('navigator', { ...navigator, userAgent, platform, maxTouchPoints: 0 });
}

function stubStandalone(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }));
}

describe('needsIosInstall', () => {
  it('is true for iPhone Safari not running standalone', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    stubStandalone(false);
    expect(needsIosInstall()).toBe(true);
  });

  it('is false for iPhone Safari already added to the home screen (standalone)', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    stubStandalone(true);
    expect(needsIosInstall()).toBe(false);
  });

  it('is false for desktop Chrome', () => {
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    stubStandalone(false);
    expect(needsIosInstall()).toBe(false);
  });
});
