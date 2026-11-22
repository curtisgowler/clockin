importScripts('queue.js');

var CACHE = 'clockin-v3';
var FILES = ['./', 'index.html', 'app.js', 'queue.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// App files open instantly from the phone, then quietly update for next time.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});

// Android: sends clock-ins saved without signal as soon as the phone gets signal, even if the app is closed.
self.addEventListener('sync', function (e) {
  if (e.tag !== 'clockin-queue') return;
  e.waitUntil(flushQueue().then(function (r) { if (r.remaining) throw new Error('still offline'); }));
});
