const CACHE_NAME = 'synregis-crm-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('/')))
  );
});

// ── Follow-up reminders (works with the app closed) ─────────────────────────
// The app keeps a snapshot of upcoming follow-ups in the 'synregis-notif'
// cache. Periodic background sync wakes this worker a few times a day; if
// follow-ups are due and it's past the configured time, notify once per day.
const DATA_CACHE = 'synregis-notif';

async function checkFollowUps() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res = await cache.match('/notif-data');
    if (!res) return;
    const data = await res.json();
    if (!data || !data.enabled) return;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const marker = await cache.match('/notif-last');
    if (marker && (await marker.text()) === today) return;
    const parts = (data.notifTime || '09:00').split(':');
    const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
    const due = (data.followUps || []).filter(f => f.date && f.date <= today);
    if (!due.length) return;
    const names = due.slice(0, 3).map(f => f.name).join(', ');
    await self.registration.showNotification('SynRegis Follow-Up', {
      body: due.length + ' project' + (due.length > 1 ? 's need' : ' needs') + ' follow-up: ' + names + (due.length > 3 ? '…' : ''),
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: 'synregis-followup'
    });
    await cache.put('/notif-last', new Response(today));
  } catch (e) { /* never break the worker over a reminder */ }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'synregis-followups') event.waitUntil(checkFollowUps());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('/');
    })
  );
});
