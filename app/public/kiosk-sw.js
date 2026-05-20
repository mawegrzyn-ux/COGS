// BACK-2728 — Kiosk PWA service worker.
//
// Goals:
//   1. Survive a network blip mid-shift — menu data + images stay served
//      from cache while we retry the network in the background (stale-
//      while-revalidate for menu-data, cache-first for images).
//   2. Cold-start offline — the SPA shell is precached so a hard reload
//      while disconnected still loads the kiosk UI from cache.
//   3. Don't poison auth-sensitive data — POST and non-GET methods are
//      always passed through to the network unmodified.
//
// Cache versioning: bump CACHE_VERSION on every deploy that changes
// behaviour worth invalidating. Old caches are pruned in `activate`.
const CACHE_VERSION  = 'v1';
const SHELL_CACHE    = `kiosk-shell-${CACHE_VERSION}`;
const DATA_CACHE     = `kiosk-data-${CACHE_VERSION}`;
const IMAGE_CACHE    = `kiosk-image-${CACHE_VERSION}`;

// Just the absolute basics — Vite hashes the rest of the JS/CSS bundles, so
// they get cached lazily as they are fetched. We precache only the entry
// HTML so a cold offline launch finds *something*.
const SHELL_URLS = [
  '/kiosk',
  '/icon.svg',
  '/icon-maskable.svg',
];

// ── install: precache the bare shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => { /* best-effort */ }))
      .then(() => self.skipWaiting())
  );
});

// ── activate: prune stale caches from prior versions ──────────────────────────
self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => keep.has(n) ? null : caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// ── fetch: route by request shape ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET. POST / PUT / DELETE go straight through — the IndexedDB queue
  // (in the page, not the SW) handles offline mutation buffering.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin: only handle our own origin. Mapbox / Auth0 / Google Fonts
  // etc. should fall through to the browser's default.
  if (url.origin !== self.location.origin) return;

  // ── App shell (HTML) — network-first, fall back to cached /kiosk ──
  // Catches both /kiosk and any SPA-routed sub-paths that arrive as full
  // navigations (rare, since the kiosk has no nested routes today).
  if (req.mode === 'navigate' && url.pathname.startsWith('/kiosk')) {
    event.respondWith(networkFirst(req, SHELL_CACHE, '/kiosk'));
    return;
  }

  // ── API: menu data — network-first with cache fallback ──
  // Everything the kiosk needs to render the menu + customise flow:
  //   /api/menus, /api/price-levels, /api/cogs/menu-sales/*,
  //   /api/menu-sales-items/*/sub-prices, /api/allergens/menu/*
  if (url.pathname.startsWith('/api/menus')              ||
      url.pathname.startsWith('/api/price-levels')       ||
      url.pathname.startsWith('/api/cogs/menu-sales')    ||
      url.pathname.startsWith('/api/allergens/menu')     ||
      /^\/api\/menu-sales-items\/\d+\/sub-prices/.test(url.pathname)) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // ── Images — cache-first with background refresh ──
  if (url.pathname.startsWith('/api/media/img') ||
      url.pathname.startsWith('/uploads/')      ||
      /\.(png|jpe?g|webp|gif|svg|tiff?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }

  // ── App bundle (JS/CSS hashed assets) — stale-while-revalidate ──
  if (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icon')) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Everything else: network-only. Don't cache auth, settings, user data.
});

// ── Strategies ─────────────────────────────────────────────────────────────────

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    // No cache, no network — let the page see the failure so it can render
    // the offline UI rather than hang.
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Refresh in background — image content rarely changes, but if a
    // sales item swaps its image_url the next visit picks it up.
    fetch(req).then((res) => { if (res.ok) cache.put(req, res); }).catch(() => {});
    return cached;
  }
  const fresh = await fetch(req);
  if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
  return fresh;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

// ── messaging — let the page nudge us to update or report status ──
self.addEventListener('message', (event) => {
  if (event.data === 'KIOSK_SW_SKIP_WAITING') self.skipWaiting();
});
