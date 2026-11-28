// NexGen phone app service worker (built into mobile/dist/sw.js by vite.config.ts).
//
// It keeps only the app's own files (screens, styles, icons) on the phone, so the
// installed app opens quickly and still opens when the station can't be reached.
// Figures are never kept here: requests outside /mobile/ (all of /api) go straight
// to the station, so every money figure on screen is live.
//
// The app page is fetched fresh from the station on every open, so a station update
// reaches the phone the next time NexGen is opened. Old builds' files are dropped
// when this worker is replaced.

const BUILD = '__BUILD__';
const FILES = __FILES__;
const CACHE = `nexgen-mobile-${BUILD}`;
const SCOPE = new URL(self.registration.scope);
const SHELL = new URL('index.html', SCOPE).href;
// Free ngrok puts a warning page in front of browser visits unless this header is sent.
const STATION_HEADERS = { 'ngrok-skip-browser-warning': '1' };

function fromStation(url, options = {}) {
  return fetch(url, { headers: STATION_HEADERS, cache: 'no-cache', credentials: 'same-origin', ...options });
}

// Marks a NexGen page that comes with this worker.
const MARKER = 'name="nexgen-app"';

// The page the station sent, or '' when it is not a usable answer.
async function pageText(response) {
  if (!response || !response.ok) return '';
  return response.clone().text();
}

// Any version of the NexGen phone page, never a tunnel warning or error page.
function isNexGenPage(text) {
  return text.includes('<title>NexGen') && text.includes('id="root"');
}

// The station is back on a phone app without this worker (an update was undone):
// remove the worker and its files so the phone runs exactly what the station serves.
let retired = false;
async function stepAside() {
  retired = true;
  await self.registration.unregister();
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith('nexgen-mobile-')).map((name) => caches.delete(name)));
}

function isAppFile(response) {
  if (!response || !response.ok) return false;
  return !(response.headers.get('content-type') || '').includes('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async (file) => {
      const url = new URL(file, SCOPE).href;
      try {
        const response = await fromStation(url);
        let keep = isAppFile(response);
        if (url === SHELL) {
          const text = await pageText(response);
          keep = isNexGenPage(text) && text.includes(MARKER);
        }
        if (keep) await cache.put(url, response);
      } catch {
        // No connection while installing: the files are kept on the next visit.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('nexgen-mobile-') && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (retired || request.method !== 'GET') return;
  const url = new URL(request.url);
  // /api and anything else outside the app: straight to the station, never kept.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname === `${SCOPE.pathname}sw.js`) return;

  if (request.mode === 'navigate') {
    event.respondWith(openApp());
  } else if (url.pathname.startsWith(`${SCOPE.pathname}assets/`)) {
    event.respondWith(keptFile(request));
  } else {
    event.respondWith(freshFile(request));
  }
});

// The app page: the station's latest when it answers, the kept copy otherwise.
// When the link sends the phone to a sign-in page (Cloudflare Access when its
// sign-in has expired), that redirect goes to the browser as it is, so the person
// sees the sign-in page instead of a kept copy that can't reach the station.
async function openApp() {
  const cache = await caches.open(CACHE);
  let response = null;
  try {
    response = await fromStation(SHELL, { redirect: 'manual' });
    if (response.type === 'opaqueredirect') return response;
    const text = await pageText(response);
    if (isNexGenPage(text)) {
      if (!text.includes(MARKER)) {
        await stepAside();
        return response;
      }
      await cache.put(SHELL, response.clone());
      return response;
    }
  } catch {
    response = null;
  }
  const kept = await cache.match(SHELL);
  if (kept) return kept;
  if (response) return response;
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>NexGen</title>'
    + '<p style="font-family:sans-serif;padding:24px">Can\'t reach the station. Check the phone\'s internet and open NexGen again.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// Built files have a new name whenever they change, so a kept copy is always right.
async function keptFile(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fromStation(request.url);
  if (isAppFile(response)) await cache.put(request, response.clone());
  return response;
}

// Icons and the app manifest keep their names, so ask the station first.
async function freshFile(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fromStation(request.url);
    if (isAppFile(response)) {
      await cache.put(request, response.clone());
      return response;
    }
    return (await cache.match(request)) || response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}
