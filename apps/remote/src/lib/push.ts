import type { RemoteContract, RpcClient } from '@switchboard/protocol/remote-client';
import { STANDALONE } from './platform.ts';
import { base64url, DEFAULT_PREFS, isIosAgent, keyBytes, parsePrefs, pushKeyFor, pushLabel, pushSupport, sameBytes, type PushPrefs, type PushSupport } from './pushSupport.ts';
import { loadPushKey, savePushKey, type PushKey } from './storage.ts';

/**
 * Push notifications on this device: the service worker, the browser's subscription, and the switches (Needs you,
 * Finished), kept on the device and sent to every computer it is paired with, which decide when to push. The
 * subscription is made with the phone's own VAPID key, which each computer gets with it, so one subscription takes
 * every computer's pushes (a browser keeps one per key).
 */

const PREFS = 'switchboard-remote:push';
const OFFERED = 'switchboard-remote:push-offered';

export function registerWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
}

export function currentSupport(): PushSupport {
  return pushSupport({
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    ios: isIosAgent(navigator.userAgent, navigator.maxTouchPoints),
    standalone: STANDALONE,
    permission: 'Notification' in window ? Notification.permission : 'default',
  });
}

export function loadPrefs(): PushPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS));
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: PushPrefs): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    // Storage off: the switches last until the page closes.
  }
}

/** The offer shows once, after pairing. */
export function offered(): boolean {
  try {
    return localStorage.getItem(OFFERED) === '1';
  } catch {
    return true;
  }
}

export function markOffered(): void {
  try {
    localStorage.setItem(OFFERED, '1');
  } catch {
    // Storage off: it may show again next time.
  }
}

type Client = RpcClient<RemoteContract>;

/** A connected computer to give the subscription to: its client, what its hello said, and its name. */
export interface PushTarget {
  client: Client;
  features: readonly string[];
  name: string;
}

/** The connected computers, and how many the phone is paired with (connected or not). */
export interface PushComputers {
  targets: readonly PushTarget[];
  paired: number;
}

/** One at a time: two computers connecting together mustn't make two keys or two subscriptions. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

/** The phone's own VAPID key pair, made the first time: every computer that takes it signs its pushes with it. */
async function ownKey(): Promise<PushKey> {
  const saved = await loadPushKey();
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const point = new Uint8Array([4, ...keyBytes(jwk.x!), ...keyBytes(jwk.y!)]);
  const key = { publicKey: base64url(point), privateKey: jwk.d! };
  await savePushKey(key);
  return key;
}

/** The browser's subscription for this key, made (or made again for another key) when needed. */
async function subscription(key: Uint8Array<ArrayBuffer>): Promise<{ subscription: PushSubscription; changed: boolean }> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameBytes(existing.options.applicationServerKey, key)) return { subscription: existing, changed: false };
  await existing?.unsubscribe();
  return { subscription: await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), changed: true };
}

/** A computer that can't push next to others: Switchboard there is older than one subscription for all. */
export const outdated = (computers: PushComputers): string[] => computers.targets.filter((t) => pushKeyFor(t.features, computers.paired) === 'none').map((t) => t.name);

/** Gives one computer the subscription. `changed`: the subscription is new, so the other computers need it too. */
async function send(target: PushTarget, prefs: PushPrefs, paired: number): Promise<'sent' | 'changed' | 'outdated'> {
  const mode = pushKeyFor(target.features, paired);
  if (mode === 'none') return 'outdated';
  const own = mode === 'own' ? await ownKey() : null;
  const key = keyBytes(own ? own.publicKey : (await target.client.call('push.key', {})).publicKey);
  const made = await subscription(key);
  const json = made.subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const label = pushLabel(target.name, paired);
  await target.client.call('push.subscribe', {
    subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
    needsYou: prefs.needsYou,
    finished: prefs.finished,
    ...(own ? { vapid: own, ...(label ? { label } : {}) } : {}),
  });
  return made.changed ? 'changed' : 'sent';
}

/** Gives every connected computer the subscription; throws only when none took it. */
async function sendAll(computers: PushComputers, prefs: PushPrefs): Promise<void> {
  const done: PushTarget[] = [];
  let failure: unknown = null;
  for (const target of computers.targets) {
    try {
      const result = await send(target, prefs, computers.paired);
      if (result === 'outdated') continue;
      // A new subscription: the ones before have the old one.
      if (result === 'changed') for (const before of done.splice(0)) await send(before, prefs, computers.paired).catch(() => {});
      done.push(target);
    } catch (error) {
      failure ??= error;
    }
  }
  if (!done.length && failure) throw failure;
}

/** Turn on: asks the browser's permission (it must follow a tap), subscribes, and tells every connected computer. */
export function turnOn(computers: PushComputers, change: Partial<PushPrefs> = {}): Promise<PushPrefs> {
  // The permission first, outside the queue: it must follow the tap.
  const asked = Notification.requestPermission();
  return serial(async () => {
    if ((await asked) !== 'granted') throw new Error('Notifications are blocked for this page. Allow them in the browser\'s settings.');
    const prefs = { ...loadPrefs(), ...change, on: true };
    await sendAll(computers, prefs);
    savePrefs(prefs);
    return prefs;
  });
}

/** Changes a switch; with both off, the computers forget this device's subscription. */
export async function update(computers: PushComputers, change: Partial<PushPrefs>): Promise<PushPrefs> {
  const prefs = { ...loadPrefs(), ...change };
  if (!prefs.needsYou && !prefs.finished) return turnOff(computers, prefs);
  if (!prefs.on) return turnOn(computers, prefs);
  return serial(async () => {
    await sendAll(computers, prefs);
    savePrefs(prefs);
    return prefs;
  });
}

export function turnOff(computers: PushComputers, keep: Partial<PushPrefs> = {}): Promise<PushPrefs> {
  return serial(async () => {
    const prefs = { ...loadPrefs(), ...keep, on: false };
    await Promise.all(computers.targets.map((t) => t.client.call('push.unsubscribe', {}).catch(() => {})));
    await dropSubscription();
    savePrefs(prefs);
    return prefs;
  });
}

async function dropSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
}

/**
 * After a computer connects: the browser may have changed the subscription, or another computer made a new one, so
 * it gets it again. When that made a new one, every other connected computer gets it too.
 */
export function resync(target: PushTarget, computers: PushComputers): Promise<void> {
  const prefs = loadPrefs();
  if (!prefs.on || currentSupport() !== 'ready' || Notification.permission !== 'granted') return Promise.resolve();
  return serial(async () => {
    if ((await send(target, prefs, computers.paired)) !== 'changed') return;
    for (const other of computers.targets) if (other.client !== target.client) await send(other, prefs, computers.paired).catch(() => {});
  }).catch(() => {});
}

/**
 * A computer is forgotten: it forgets the subscription, and since it had the phone's key and the subscription's
 * address, both are made again, for the computers that stay (the ones not connected get them when they connect).
 */
export function forgetPush(target: PushTarget | null, rest: PushComputers): Promise<void> {
  return serial(async () => {
    await target?.client.call('push.unsubscribe', {}).catch(() => {});
    await savePushKey(null);
    await dropSubscription();
    const prefs = loadPrefs();
    if (prefs.on && rest.targets.length && currentSupport() === 'ready' && Notification.permission === 'granted') await sendAll(rest, prefs).catch(() => {});
  });
}
