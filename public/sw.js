const CACHE_NAME = 'cannonfall-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  // Clean up old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip caching for socket.io, health checks, and non-GET requests
  if (
    url.pathname.startsWith('/socket.io') ||
    url.pathname === '/health' ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  // Cache-first for static assets, network-first for navigation
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Only cache successful same-origin responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      });
    })
  );
});
