import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keysFor } from './shortcuts.ts';
import { maximizeStep, sessionKey } from './sessionKeys.ts';

/** The key press of a registry shortcut, as a keydown event would carry it. */
const pressOf = (id: Parameters<typeof keysFor>[0]) => {
  const combo = keysFor(id).split('+');
  const key = combo.pop()!;
  return { key, code: '', metaKey: combo.includes('cmd'), ctrlKey: combo.includes('ctrl'), altKey: combo.includes('alt'), shiftKey: combo.includes('shift') };
};

describe('sessionKey', () => {
  beforeEach(() => vi.stubGlobal('window', { seshboard: { platform: 'win32' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('knows the terminal and editor keys in both windows', () => {
    for (const inPopout of [false, true]) {
      expect(sessionKey(pressOf('terminal.toggle'), inPopout)).toBe('terminal.toggle');
      expect(sessionKey(pressOf('terminal.maximize'), inPopout)).toBe('terminal.maximize');
      expect(sessionKey(pressOf('editor.open'), inPopout)).toBe('editor.open');
    }
  });

  it('leaves Open in new window to the main window', () => {
    expect(sessionKey(pressOf('session.new-window'), false)).toBe('session.new-window');
    expect(sessionKey(pressOf('session.new-window'), true)).toBeNull();
  });

  it('ignores every other key', () => {
    expect(sessionKey(pressOf('palette.goto'), false)).toBeNull();
    expect(sessionKey({ key: 'a', code: 'KeyA', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
  });
});

describe('maximizeStep', () => {
  it('toggles an open terminal and opens a closed one maximized', () => {
    expect(maximizeStep(true)).toBe('toggle');
    expect(maximizeStep(false)).toBe('open-maximized');
  });
});
