/* ============================================================
   Factory Gate Pass Manager — Service Worker (app-install helper)
   ------------------------------------------------------------
   What this does (simple words):
   1) Lets the browser offer "📱 Install App" (home-screen icon,
      full-screen app-like window).
   2) Keeps a copy of the app SCREENS so the app opens fast and
      the shell still shows if the network blinks.
   What it does NOT do:
   - It never caches or touches your DATA. Passes, approvals and
     login always go live to Google Firebase — internet is still
     required for real data.
   ============================================================ */
const VER = 'gp-shell-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only handle our own files. Firebase / Google / CDN requests
  // go straight to the internet, untouched.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first (fresh app every visit), fall back to cache if offline.
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); }
        return r;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
