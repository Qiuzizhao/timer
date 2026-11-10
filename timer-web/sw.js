const scope = new URL(self.registration.scope);
// Cache Storage is shared by every service worker on this origin.
const CACHE_PREFIX = scope.pathname === '/' ? 'quiet-timer-' : `quiet-timer:${scope.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ASSETS = [
  './index.html', './desktop-install.js', './offline-cache.js', './manifest.json',
  './icons/timer-192.png', './icons/timer-512.png',
  './sounds/timer-prompt.wav', './sounds/timer-tick.wav', './sounds/timer-ring.wav',
  './sounds/timer-add-minute-voice.wav', './sounds/timer-subtract-minute-voice-yunyang-10.wav',
].map(path => new URL(path, scope).href);
const INDEX = ASSETS[0];

self.addEventListener('install', event => {
  // Finish downloading the complete offline set before taking control.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, { cache: 'no-cache' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function audioRange(response, range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return response;
  const bytes = await response.arrayBuffer();
  const length = bytes.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
  if (start >= length || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${length}` } });
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin) return;
  // The scope URL and index.html share one copy, including visits with query parameters.
  const key = url.pathname === scope.pathname || url.pathname === new URL(INDEX).pathname
    ? INDEX : new URL(url.pathname, url.origin).href;
  if (!ASSETS.includes(key)) return;
  const cachePromise = caches.open(CACHE_NAME);
  // HTTP validators (ETag/Last-Modified) avoid downloading unchanged contents.
  const fresh = cachePromise.then(async cache => {
    const previous = await cache.match(key);
    const headers = new Headers();
    if (previous?.headers.get('ETag')) headers.set('If-None-Match', previous.headers.get('ETag'));
    else if (previous?.headers.get('Last-Modified')) headers.set('If-Modified-Since', previous.headers.get('Last-Modified'));
    const response = await fetch(new Request(key, { cache: 'no-store', headers }));
    if (response.status === 304 && previous) return previous;
    if (response.ok) await cache.put(key, response.clone());
    return response;
  });
  event.waitUntil(fresh.catch(() => {}));
  event.respondWith((async () => {
    const cache = await cachePromise;
    const cached = await cache.match(key);
    const response = cached || await fresh;
    const range = event.request.headers.get('Range');
    return range && response.ok && key.endsWith('.wav') ? audioRange(response, range) : response;
  })());
});
