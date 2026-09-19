/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

interface PushPayload { title: string; body: string; url: string }

self.addEventListener('push', (event) => {
  const p: PushPayload = event.data ? event.data.json() : { title: 'Plantry', body: '', url: '/' };
  event.waitUntil(self.registration.showNotification(p.title, { body: p.body, icon: '/favicon.svg', badge: '/favicon.svg', tag: p.url, data: { url: p.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw: string = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  const url = new URL(raw, self.location.origin).origin === self.location.origin ? raw : '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins[0];
    if (existing) { await existing.focus(); await existing.navigate(url).catch(() => undefined); return; }
    await self.clients.openWindow(url);
  })());
});
