import { describe, expect, it } from 'vitest';
import { newLineKey, sendKey } from './sendMode.ts';

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('sendKey', () => {
  it('queues on Enter and leaves Shift+Enter for a new line', () => {
    expect(sendKey(key('Enter'), true)).toBe('queue');
    expect(sendKey(key('Enter', { metaKey: true }), true)).toBe('queue');
    expect(sendKey(key('Enter', { shiftKey: true }), true)).toBeNull();
    expect(sendKey(key('a'), true)).toBeNull();
  });

  it('steers on ⌥↵ and sends now on ⌘⇧↵, with Ctrl on Windows', () => {
    expect(sendKey(key('Enter', { altKey: true }), true)).toBe('steer');
    expect(sendKey(key('Enter', { metaKey: true, shiftKey: true }), true)).toBe('now');
    expect(sendKey(key('Enter', { ctrlKey: true, shiftKey: true }), false)).toBe('now');
    // The other platform's modifier is someone else's shortcut.
    expect(sendKey(key('Enter', { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(sendKey(key('Enter', { metaKey: true, shiftKey: true }), false)).toBeNull();
  });

  it('leaves a key that finishes composing a character alone', () => {
    expect(sendKey(key('Enter', { isComposing: true }), true)).toBeNull();
  });
});

describe('newLineKey', () => {
  it('is Shift+Enter where Enter sends, and Return where it does not', () => {
    expect(newLineKey(key('Enter', { shiftKey: true }), true)).toBe(true);
    expect(newLineKey(key('Enter'), true)).toBe(false);
    expect(newLineKey(key('Enter'), false)).toBe(true);
    expect(newLineKey(key('a', { shiftKey: true }), true)).toBe(false);
  });

  it('leaves the keys that send and composing alone', () => {
    expect(newLineKey(key('Enter', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(newLineKey(key('Enter', { ctrlKey: true }), false)).toBe(false);
    expect(newLineKey(key('Enter', { altKey: true }), false)).toBe(false);
    expect(newLineKey(key('Enter', { isComposing: true }), false)).toBe(false);
  });
});
