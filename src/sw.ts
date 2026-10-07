/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { PERIODIC_SYNC_TAG, runReminderCheck } from "./lib/reminderCheck";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> };

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}

self.skipWaiting();
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
} catch {
  // In dev mode index.html is not precached.
}

function show(n: { tag: string; title: string; body: string; route: string }) {
  return self.registration.showNotification(n.title, {
    body: n.body,
    tag: n.tag,
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    data: { route: n.route },
  });
}

self.addEventListener("periodicsync", (event) => {
  const e = event as PeriodicSyncEvent;
  if (e.tag === PERIODIC_SYNC_TAG) e.waitUntil(runReminderCheck(show));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "check-reminders") event.waitUntil(runReminderCheck(show));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route: string = event.notification.data?.route ?? "/";
  const url = `${self.registration.scope}#${route}`;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.startsWith(self.registration.scope)) {
          await (c as WindowClient).focus();
          c.postMessage({ type: "navigate", route });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
