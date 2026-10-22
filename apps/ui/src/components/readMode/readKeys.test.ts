import { describe, expect, it } from 'vitest';
import { readModeKey, type ReadKeyFocus } from './readKeys.ts';

const free: ReadKeyFocus = { typing: false, inToolbar: false, overlay: false, sidebar: false, selection: false };
const key = (k: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

describe('the reading mode keys', () => {
  it('maps the keys to their actions', () => {
    expect(readModeKey(key('ArrowLeft'), free)).toBe('previous');
    expect(readModeKey(key('ArrowRight'), free)).toBe('next');
    expect(readModeKey(key('k'), free)).toBe('previous-heading');
    expect(readModeKey(key('j'), free)).toBe('next-heading');
    expect(readModeKey(key('-'), free)).toBe('smaller');
    expect(readModeKey(key('='), free)).toBe('bigger');
    expect(readModeKey(key('+', { shiftKey: true }), free)).toBe('bigger');
  });

  it('replies only with a selection', () => {
    expect(readModeKey(key('r'), free)).toBeNull();
    expect(readModeKey(key('r'), { ...free, selection: true })).toBe('reply');
  });

  it('leaves keys with a modifier to the other shortcuts', () => {
    expect(readModeKey(key('r', { metaKey: true }), { ...free, selection: true })).toBeNull();
    expect(readModeKey(key('ArrowLeft', { altKey: true }), free)).toBeNull();
    expect(readModeKey(key('-', { ctrlKey: true }), free)).toBeNull();
  });

  it('waits while a field has the focus, the popover, a menu, a dialog or the session list is open, or text is composed', () => {
    for (const blocked of [{ typing: true }, { inToolbar: true }, { overlay: true }, { sidebar: true }]) {
      expect(readModeKey(key('j'), { ...free, ...blocked })).toBeNull();
    }
    expect(readModeKey(key('j', { isComposing: true }), free)).toBeNull();
  });

  it('ignores other keys', () => {
    expect(readModeKey(key('x'), free)).toBeNull();
  });
});
