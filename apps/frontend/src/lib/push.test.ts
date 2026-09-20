import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSubscription, needsIosInstall, sameKey, subscribePush, urlBase64ToUint8Array } from './push';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('currentSubscription', () => {
  const sub = { endpoint: 'https://sub' } as unknown as PushSubscription;

  function stubSw(serviceWorker: unknown) {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { requestPermission: vi.fn() });
  }

  it('waits for serviceWorker.ready rather than trusting an empty getRegistration()', async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    stubSw({
      ready: Promise.resolve({ pushManager: { getSubscription: async () => sub } }),
      getRegistration,
    });

    await expect(currentSubscription()).resolves.toBe(sub);
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it('falls back to getRegistration() when ready never resolves', async () => {
    vi.useFakeTimers();
    stubSw({
      ready: new Promise(() => {}),
      getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: async () => sub } }),
    });

    const pending = currentSubscription();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(sub);
  });
});

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('urlBase64ToUint8Array', () => {
  it('round-trips base64url-encoded bytes', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => i * 3 + 7);
    expect(urlBase64ToUint8Array(toB64url(bytes))).toEqual(bytes);
  });
});

describe('sameKey', () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  it('is true for byte-for-byte identical keys', () => {
    expect(sameKey(bytes.buffer, bytes)).toBe(true);
    expect(sameKey(Uint8Array.from(bytes).buffer, bytes)).toBe(true);
  });
  it('is false when the bytes differ', () => {
    expect(sameKey(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9]).buffer, bytes)).toBe(false);
  });
  it('is false when the lengths differ', () => {
    expect(sameKey(Uint8Array.from([1, 2, 3]).buffer, bytes)).toBe(false);
  });
  it('is false when there is no existing key', () => {
    expect(sameKey(null, bytes)).toBe(false);
  });
});

describe('subscribePush', () => {
  function stubEnv(pushManager: { getSubscription: () => unknown; subscribe: (...args: unknown[]) => unknown }, permission: NotificationPermission = 'granted') {
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue(permission) });
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: Promise.resolve({ pushManager }) } });
  }

  it('reuses an existing subscription made under the same key, without calling subscribe again', async () => {
    const keyBytes = Uint8Array.from([10, 20, 30, 40]);
    const vapidPublicKey = toB64url(keyBytes);
    const existing = { options: { applicationServerKey: Uint8Array.from(keyBytes).buffer }, unsubscribe: vi.fn(), toJSON: () => ({ endpoint: 'https://existing' }) };
    const subscribe = vi.fn();
    stubEnv({ getSubscription: async () => existing, subscribe });

    const result = await subscribePush(vapidPublicKey);

    expect(result.endpoint).toBe('https://existing');
    expect(subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it('drops a subscription made under a DIFFERENT (rotated) key and subscribes fresh', async () => {
    const keyBytes = Uint8Array.from([10, 20, 30, 40]);
    const vapidPublicKey = toB64url(keyBytes);
    const staleKeyBytes = Uint8Array.from([1, 1, 1, 1]);
    const existing = { options: { applicationServerKey: staleKeyBytes.buffer }, unsubscribe: vi.fn().mockResolvedValue(undefined), toJSON: () => ({ endpoint: 'https://stale' }) };
    const fresh = { toJSON: () => ({ endpoint: 'https://fresh' }) };
    const subscribe = vi.fn().mockResolvedValue(fresh);
    stubEnv({ getSubscription: async () => existing, subscribe });

    const result = await subscribePush(vapidPublicKey);

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(result.endpoint).toBe('https://fresh');
  });

  it('throws when notification permission is not granted', async () => {
    stubEnv({ getSubscription: async () => null, subscribe: vi.fn() }, 'denied');
    await expect(subscribePush(toB64url(Uint8Array.from([1])))).rejects.toThrow('Notifications are blocked for this site');
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
