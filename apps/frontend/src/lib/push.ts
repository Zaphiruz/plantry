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

export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.ready;
  // TS's lib.dom types the Uint8Array's `.buffer` as ArrayBufferLike (which admits SharedArrayBuffer),
  // not the plain ArrayBuffer that PushSubscriptionOptionsInit demands; a same-shape BufferSource cast
  // is the standard workaround (the runtime value is a plain Uint8Array either way).
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey) as BufferSource;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    } catch (err) {
      // A subscription created under a previously-rotated VAPID key makes subscribe() throw
      // InvalidStateError; drop it and retry once under the current key.
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        const stale = await reg.pushManager.getSubscription();
        await stale?.unsubscribe();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      } else {
        throw err;
      }
    }
  }
  return sub.toJSON();
}

export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}
