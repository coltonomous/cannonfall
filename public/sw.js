const CACHE_NAME = 'cannonfall-v1'; // bumped to the build number on deploy

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  // Clean up old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function cacheResponse(request) {
  return (response) => {
    // Only cache successful same-origin responses
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  };
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Leave socket.io, health checks, non-GET and cross-origin requests to the network
  if (
    e.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname === '/health'
  ) {
    return;
  }

  // Pages: network first so a deploy shows up on the next load, cached copy when offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(cacheResponse(e.request)).catch(() => caches.match(e.request))
    );
    return;
  }

  // Built assets are content-hashed and models are versioned per deploy: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(cacheResponse(e.request)))
  );
});
