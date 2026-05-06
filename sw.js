// KarkhanaPro service worker — minimal cache for app shell.
const CACHE = 'karkhanapro-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1',
  './app.js?v=1',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Network-first for HTML so updates land fast
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  // Cache-first for static assets
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});
