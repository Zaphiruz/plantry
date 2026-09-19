export const pushSupported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS only delivers Web Push to PWAs installed to the home screen. */
export function needsIosInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

// Exported (the brief's version is a local helper) so it can be unit-tested for a round-trip
// without going through the whole subscribe flow.
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Byte-for-byte comparison of an existing subscription's key against the key we'd subscribe with now. */
export function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const av = new Uint8Array(a);
  if (av.length !== b.length) return false;
  for (let i = 0; i < av.length; i++) if (av[i] !== b[i]) return false;
  return true;
}

export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.ready;
  const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
  // TS's lib.dom types the Uint8Array's `.buffer` as ArrayBufferLike (which admits SharedArrayBuffer),
  // not the plain ArrayBuffer that PushSubscriptionOptionsInit demands; a same-shape BufferSource cast
  // is the standard workaround (the runtime value is a plain Uint8Array either way).
  const applicationServerKey = keyBytes as BufferSource;

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Reuse only if it was created under the SAME key. A subscription made under a rotated VAPID
    // key must never be returned as-is: it would be POSTed to the server as a valid subscription
    // for the wrong key pair, and pushManager.subscribe() also refuses to hand out a second
    // subscription while one already exists, so it must be dropped before subscribing again.
    if (sameKey(existing.options.applicationServerKey, keyBytes)) return existing.toJSON();
    await existing.unsubscribe();
  }

  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    return sub.toJSON();
  } catch (err) {
    // Belt-and-braces: some browsers still throw InvalidStateError here (e.g. a subscription
    // reappeared between the unsubscribe above and this call). Drop whatever is there now and
    // retry exactly once.
    if (err instanceof DOMException && err.name === 'InvalidStateError') {
      const stale = await reg.pushManager.getSubscription();
      await stale?.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      return sub.toJSON();
    }
    throw err;
  }
}

export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}
