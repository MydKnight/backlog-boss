const SHELL_CACHE = 'backlog-boss-shell-v2';
const API_CACHE   = 'backlog-boss-api-v2';

const PRECACHE = ['/', '/index.html'];

// ---------------------------------------------------------------------------
// Install — cache the app shell
// ---------------------------------------------------------------------------

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — remove old caches
// ---------------------------------------------------------------------------

self.addEventListener('activate', e => {
  const keep = new Set([SHELL_CACHE, API_CACHE]);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch — two strategies
//
//   API GET requests  → network-first, fall back to cache
//   Static assets     → cache-first, fall back to network (then cache)
//   API non-GET       → always network (mutations must not be cached)
// ---------------------------------------------------------------------------

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Never cache mutations
    if (request.method !== 'GET') return;
    e.respondWith(networkFirstApi(request));
  } else {
    if (request.method !== 'GET') return;
    e.respondWith(cacheFirstShell(request));
  }
});

/**
 * Network-first for API routes.
 * On network success: update cache, return response.
 * On network failure: serve stale cache if available, otherwise propagate error.
 */
async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone before consuming — Response body can only be read once
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Return a structured offline error so the UI can distinguish "offline" from "server error"
    return new Response(
      JSON.stringify({ error: 'offline', message: 'No network — showing cached data.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Cache-first for static assets (JS, CSS, fonts, images).
 * Caches on first network fetch, serves from cache thereafter.
 */
async function cacheFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // If it's a navigation request and we have the shell, serve index.html
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    throw new Error('Offline and no cached version available.');
  }
}
