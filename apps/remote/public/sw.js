/*
 * Switchboard Remote's service worker. It only shows notifications: a push from the computer (encrypted for this
 * browser, see docs/remote-access.md) when a session needs you or finishes, and a tap that opens that session. It
 * caches nothing and never touches the network.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not one of ours: still show something, as browsers require for every push.
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Switchboard';
  const line = typeof data.line === 'string' ? data.line : data.kind === 'finished' ? 'Claude finished a turn.' : 'Claude needs you.';
  const body = typeof data.project === 'string' && data.project ? `${data.project} · ${line}` : line;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // One notification per session and kind: a newer one replaces it.
      tag: `${data.kind ?? 'switchboard'}:${data.sessionId ?? ''}`,
      renotify: data.kind === 'needs-you',
      icon: new URL('icon-192.png', self.registration.scope).href,
      data: { sessionId: typeof data.sessionId === 'string' ? data.sessionId : null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;
  const url = new URL(sessionId ? `./?s=${encodeURIComponent(sessionId)}` : './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        if (sessionId) open.postMessage({ type: 'open-session', sessionId });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
