import type { RemoteContract, RpcClient } from '@switchboard/protocol/remote-client';
import { DEFAULT_PREFS, isIosAgent, keyBytes, parsePrefs, pushSupport, sameBytes, type PushPrefs, type PushSupport } from './pushSupport.ts';

/**
 * Push notifications on this device: the service worker, the browser's subscription with the computer's key, and the
 * switches (Needs you, Finished), kept on the device and sent to the computer, which decides when to push.
 */

const PREFS = 'switchboard-remote:push';
const OFFERED = 'switchboard-remote:push-offered';

export function registerWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
}

export function currentSupport(): PushSupport {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return pushSupport({
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    ios: isIosAgent(navigator.userAgent, navigator.maxTouchPoints),
    standalone,
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

/** The browser's subscription for this computer's key, made (or made again for another computer) when needed. */
async function subscription(client: Client): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const key = keyBytes((await client.call('push.key', {})).publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameBytes(existing.options.applicationServerKey, key)) return existing;
  await existing?.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

async function send(client: Client, prefs: PushPrefs): Promise<void> {
  const json = (await subscription(client)).toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await client.call('push.subscribe', { subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, needsYou: prefs.needsYou, finished: prefs.finished });
}

/** Turn on: asks the browser's permission (it must follow a tap), subscribes, and tells the computer. */
export async function turnOn(client: Client, change: Partial<PushPrefs> = {}): Promise<PushPrefs> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this page. Allow them in the browser\'s settings.');
  const prefs = { ...loadPrefs(), ...change, on: true };
  await send(client, prefs);
  savePrefs(prefs);
  return prefs;
}

/** Changes a switch; with both off, the computer forgets this device's subscription. */
export async function update(client: Client, change: Partial<PushPrefs>): Promise<PushPrefs> {
  const prefs = { ...loadPrefs(), ...change };
  if (!prefs.needsYou && !prefs.finished) return turnOff(client, prefs);
  if (!prefs.on) return turnOn(client, prefs);
  await send(client, prefs);
  savePrefs(prefs);
  return prefs;
}

export async function turnOff(client: Client | null, keep: Partial<PushPrefs> = {}): Promise<PushPrefs> {
  const prefs = { ...loadPrefs(), ...keep, on: false };
  await client?.call('push.unsubscribe', {}).catch(() => {});
  const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  savePrefs(prefs);
  return prefs;
}

/** After each connection: the browser may have changed the subscription, so the computer gets it again. */
export async function resync(client: Client): Promise<void> {
  const prefs = loadPrefs();
  if (!prefs.on || currentSupport() !== 'ready' || Notification.permission !== 'granted') return;
  await send(client, prefs).catch(() => {});
}
