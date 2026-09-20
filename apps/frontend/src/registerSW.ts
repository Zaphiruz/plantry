import { registerSW } from 'virtual:pwa-register';

/**
 * Single registration path for the service worker (`injectRegister: false` in vite.config.ts
 * keeps vite-plugin-pwa from injecting a second one).
 *
 * The worker calls `skipWaiting()` + `clients.claim()`, so a new build takes over documents that
 * are still running the old bundle. Their lazily-imported hashed chunks no longer exist in the
 * new precache, so the next dynamic import 404s. Reloading once, when a NEW worker takes over a
 * document that already had one, puts the document back in sync with the worker.
 *
 * `hadController` is the guard: on a first-ever install there is no controller, `controllerchange`
 * fires as soon as the fresh worker claims the page, and reloading then would be pointless (and
 * on a misbehaving worker, a loop).
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  registerSW({ immediate: true });
}
