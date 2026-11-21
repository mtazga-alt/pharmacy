/* Service Worker — يجعل التطبيق يعمل بدون إنترنت ويمكن تثبيته على الجوال */
const CACHE = 'pharma-v1';
const ASSETS = [
  './', 'index.html', 'manifest.json',
  'css/style.css', 'js/app.js', 'js/config.js',
  'lib/lucide.min.js', 'lib/html5-qrcode.min.js',
  'lib/fonts/cairo.css', 'lib/fonts/cairo-arabic.woff2', 'lib/fonts/cairo-latin.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ملفات التطبيق: الشبكة أولاً (لتصل التحديثات فوراً) ثم النسخة المحفوظة
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // مكتبات Firebase من gstatic: من الذاكرة أولاً
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
