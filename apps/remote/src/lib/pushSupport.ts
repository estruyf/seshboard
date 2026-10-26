import { REMOTE_FEATURE_PUSH_KEY } from '@seshboard/protocol/remote-client';

/**
 * Whether this browser can get push notifications, and what to say when it can't. Pure: the browser's answers come
 * in as parameters, so iOS's rules are easy to check. iOS only allows push for a page added to the Home Screen and
 * opened from there.
 */
export type PushSupport = 'ready' | 'home-screen' | 'denied' | 'unsupported';

export interface BrowserFacts {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** iPhone or iPad (iPadOS Safari says it's a Mac; only its touch screen tells). */
  ios: boolean;
  /** Opened from the Home Screen. */
  standalone: boolean;
  permission: 'default' | 'granted' | 'denied';
}

export function pushSupport(facts: BrowserFacts): PushSupport {
  if (facts.ios && !facts.standalone) return 'home-screen';
  if (!facts.serviceWorker || !facts.pushManager || !facts.notification) return 'unsupported';
  if (facts.permission === 'denied') return 'denied';
  return 'ready';
}

export const isIosAgent = (userAgent: string, maxTouchPoints: number) => /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

/** A VAPID key (base64url) as `pushManager.subscribe` takes it. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Bytes as base64url without padding, as VAPID keys are written. */
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Which key the subscription is made with for a computer: the phone's own, which every computer that takes it
 * (`REMOTE_FEATURE_PUSH_KEY`) signs with, so one subscription gets them all; an older computer's own key while it is
 * the only one paired; or none, for an older computer next to others, whose key would take the subscription away
 * from them.
 */
export type PushKeyFor = 'own' | 'computer' | 'none';

export function pushKeyFor(features: readonly string[], paired: number): PushKeyFor {
  if (features.includes(REMOTE_FEATURE_PUSH_KEY)) return 'own';
  return paired <= 1 ? 'computer' : 'none';
}

/** What a computer's pushes start with: its name, once the phone is paired with more than one. */
export function pushLabel(name: string, paired: number): string | undefined {
  const label = name.trim().slice(0, 60);
  return paired > 1 && label ? label : undefined;
}

export const sameBytes = (a: ArrayBuffer | Uint8Array | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((byte, i) => byte === b[i]);
};

/** What this device asked for, kept on the device. */
export interface PushPrefs {
  on: boolean;
  needsYou: boolean;
  finished: boolean;
}

export const DEFAULT_PREFS: PushPrefs = { on: false, needsYou: true, finished: true };

export function parsePrefs(raw: string | null): PushPrefs {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<PushPrefs> | null;
    if (!value || typeof value !== 'object') return DEFAULT_PREFS;
    return { on: value.on === true, needsYou: value.needsYou !== false, finished: value.finished !== false };
  } catch {
    return DEFAULT_PREFS;
  }
}
