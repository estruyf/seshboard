import { afterEach, describe, expect, it, vi } from 'vitest';
import { inUseMessage, shortcutProblem } from './quickStartCopy.ts';

const on = (platform: string) => vi.stubGlobal('window', { seshboard: { platform } });

describe('quick start settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says when another app has the shortcut, in the platform’s keys', () => {
    on('darwin');
    expect(inUseMessage('ctrl+alt+space')).toBe('⌃⌥Space is in use by another app. Pick another.');
    on('win32');
    expect(inUseMessage('ctrl+alt+space')).toBe('Ctrl+Alt+Space is in use by another app. Pick another.');
  });

  it('takes a shortcut with a modifier that Seshboard doesn’t use itself', () => {
    on('darwin');
    expect(shortcutProblem('ctrl+alt+space', 'darwin')).toBeNull();
    expect(shortcutProblem('cmd+shift+space', 'darwin')).toBeNull();
    expect(shortcutProblem('space', 'darwin')).toBe('Include ⌘, ⌃ or ⌥');
    expect(shortcutProblem('shift+k', 'win32')).toBe('Include Ctrl or Alt');
    expect(shortcutProblem('cmd+k', 'darwin')).toBe('Seshboard uses ⌘K. Pick another.');
  });
});
