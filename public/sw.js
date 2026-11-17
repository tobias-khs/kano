// scripts/build.ts stamps the cache name, so every build gets a fresh cache.
const CACHE = 'kano-__BUILD__'
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'db.js',
  'schedule.js',
  'manifest.webmanifest',
  'icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(event.request)),
  )
})
