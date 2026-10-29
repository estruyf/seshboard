/*
 * Seshboard Remote's service worker. It only shows notifications: a push from the computer (encrypted for this
 * browser, see docs/remote-access.md) when a session needs you or finishes, and a tap that opens that session. A
 * tool prompt gets Deny and Allow where the browser shows buttons (Chrome, Edge and Firefox on a computer; not
 * Safari or iOS): the page sends the answer once it is connected, and only if the prompt is still open. A phone
 * paired with more than one computer gets each computer's pushes: `deviceId` says which computer sent one (it is the
 * id that computer gave this device), and `computer` (its name) starts the line. It caches nothing and never touches
 * the network.
 */

/** An answer from a notification's button, until the page it opened asks for it (`take-answer`). */
let pending = null;
/** How long a page that is opening may take to ask. */
const HANDOFF_MS = 30000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not one of ours: still show something, as browsers require for every push.
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Seshboard';
  const line = typeof data.line === 'string' ? data.line : data.kind === 'finished' ? 'Claude finished a turn.' : 'Claude needs you.';
  // With more than one computer, its name first; with more than one Claude profile, the profile
  // ("mystic · Work · web · Allow Bash: npm publish --tag beta").
  const body = [data.computer, data.profile, data.project, line].filter((part) => typeof part === 'string' && part).join(' · ');
  const deviceId = typeof data.deviceId === 'string' ? data.deviceId : null;
  const answers = data.kind === 'needs-you' && data.answers === true && typeof data.requestId === 'string' && (self.Notification?.maxActions ?? 0) >= 2;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // One notification per computer, session and kind: a newer one replaces it.
      tag: `${data.kind ?? 'seshboard'}:${deviceId ?? ''}:${data.sessionId ?? ''}`,
      renotify: data.kind === 'needs-you',
      icon: new URL('icon-192.png', self.registration.scope).href,
      ...(answers
        ? {
            actions: [
              { action: 'deny', title: 'Deny' },
              { action: 'allow', title: 'Allow' },
            ],
          }
        : {}),
      data: { sessionId: typeof data.sessionId === 'string' ? data.sessionId : null, requestId: answers ? data.requestId : null, deviceId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const sessionId = data.sessionId;
  const deviceId = data.deviceId || null;
  const answer = (event.action === 'allow' || event.action === 'deny') && data.requestId ? { type: 'answer', sessionId, requestId: data.requestId, behavior: event.action, deviceId } : null;
  const query = sessionId ? `?s=${encodeURIComponent(sessionId)}${deviceId ? `&d=${encodeURIComponent(deviceId)}` : ''}` : '';
  const url = new URL(`./${query}`, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        if (sessionId && !answer) open.postMessage({ type: 'open-session', sessionId, deviceId });
        if (answer) open.postMessage(answer);
        return;
      }
      if (!answer) return void (await self.clients.openWindow(url));
      // A new page isn't listening yet: keep the answer (and this worker) until it asks, or for half a minute.
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending = null;
          resolve();
        }, HANDOFF_MS);
        pending = { answer, done: () => (clearTimeout(timer), resolve()) };
        void self.clients.openWindow(url);
      });
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'take-answer' || !pending || !event.source) return;
  const { answer, done } = pending;
  pending = null;
  event.source.postMessage(answer);
  done();
});
