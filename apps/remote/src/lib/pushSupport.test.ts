import { describe, expect, it } from 'vitest';
import { REMOTE_FEATURE_PUSH_KEY } from '@seshboard/protocol/remote-client';
import { base64url, isIosAgent, keyBytes, parsePrefs, pushKeyFor, pushLabel, pushSupport, sameBytes, type BrowserFacts } from './pushSupport.ts';

const facts = (change: Partial<BrowserFacts> = {}): BrowserFacts => ({ serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: false, permission: 'default', ...change });

describe('pushSupport', () => {
  it('is ready in a browser with push', () => {
    expect(pushSupport(facts())).toBe('ready');
    expect(pushSupport(facts({ permission: 'granted' }))).toBe('ready');
  });

  it('asks iPhones to add the page to the Home Screen first', () => {
    expect(pushSupport(facts({ ios: true, pushManager: false, notification: false }))).toBe('home-screen');
    expect(pushSupport(facts({ ios: true, standalone: true }))).toBe('ready');
  });

  it('says when it can\'t', () => {
    expect(pushSupport(facts({ pushManager: false }))).toBe('unsupported');
    expect(pushSupport(facts({ permission: 'denied' }))).toBe('denied');
  });

  it('knows an iPad that calls itself a Mac', () => {
    expect(isIosAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIosAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIosAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
  });
});

describe('push helpers', () => {
  it('reads a VAPID key', () => {
    const bytes = keyBytes('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(sameBytes(bytes.buffer, bytes)).toBe(true);
    expect(sameBytes(null, bytes)).toBe(false);
  });

  it('keeps the switches, both on by default', () => {
    expect(parsePrefs(null)).toEqual({ on: false, needsYou: true, finished: true });
    expect(parsePrefs('{"on":true,"finished":false}')).toEqual({ on: true, needsYou: true, finished: false });
    expect(parsePrefs('not json')).toEqual({ on: false, needsYou: true, finished: true });
  });
});

describe('one subscription for every computer', () => {
  it('uses the phone\'s own key with every computer that takes it, an older one\'s only while it is the only one', () => {
    expect(pushKeyFor([REMOTE_FEATURE_PUSH_KEY], 1)).toBe('own');
    expect(pushKeyFor([REMOTE_FEATURE_PUSH_KEY], 3)).toBe('own');
    expect(pushKeyFor([], 1)).toBe('computer');
    expect(pushKeyFor([], 2)).toBe('none');
  });

  it('starts pushes with the computer\'s name only with more than one computer', () => {
    expect(pushLabel('mystic', 1)).toBeUndefined();
    expect(pushLabel('mystic', 2)).toBe('mystic');
    expect(pushLabel('  ', 2)).toBeUndefined();
  });

  it('writes keys back as base64url', () => {
    const key = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
    expect(base64url(keyBytes(key))).toBe(key);
  });
});
