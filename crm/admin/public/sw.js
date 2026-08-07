// BH CRM service worker — intentionally network-only.
// Its only job is to satisfy PWA installability (a registered SW with a fetch
// handler) so the app can be added to the phone home screen. It deliberately
// does NOT cache the app shell or API responses: this is a live tool where a
// stale JS bundle or stale data would be worse than a network round-trip.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass through to the network. No respondWith → default browser fetch.
});
