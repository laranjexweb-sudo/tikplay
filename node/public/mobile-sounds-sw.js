const CACHE_NAME = 'tikplay-sounds-shell-v3';
const SHELL = ['/sons-mobile', '/sons-mobile/manifest.json'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/logs' || url.pathname.startsWith('/alert-audio/') || url.pathname.startsWith('/tts-audio/')) return;
  if (event.request.mode === 'navigate' && url.pathname === '/sons-mobile') event.respondWith(fetch(event.request).catch(() => caches.match('/sons-mobile')));
});
