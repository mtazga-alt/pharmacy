/* Service Worker — العمل بدون إنترنت والتثبيت على الجوال */
const CACHE = 'pharma-v3';
const ASSETS = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
const put = (req, res) => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; };
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.endsWith('catalog.json')) {
    // دليل الأدوية: من الذاكرة فوراً، مع تحديثه في الخلفية
    e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => put(req, r)).catch(() => hit); return hit || net; }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }
  if (url.hostname === 'www.gstatic.com') e.respondWith(caches.match(req).then(r => r || fetch(req).then(x => put(req, x))));
});
