import { describe, expect, it } from 'vitest';
import { inView, isTypingTarget, KEY_LIST, keyAction, keyLabel, nextIndex, type KeyContext, type KeyEventLike } from './keys.ts';

const press = (key: string, change: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...change });
const MAC: KeyContext = { mac: true, inField: false };
const WIN: KeyContext = { mac: false, inField: false };
const inField = (context: KeyContext): KeyContext => ({ ...context, inField: true });

describe('keyAction', () => {
  it('shows or hides the sessions with ⌘B on a Mac and Ctrl+B elsewhere', () => {
    expect(keyAction(press('b', { metaKey: true }), MAC)).toBe('sidebar');
    expect(keyAction(press('b', { ctrlKey: true }), inField(WIN))).toBe('sidebar');
    expect(keyAction(press('b', { ctrlKey: true }), MAC)).toBeNull();
    expect(keyAction(press('b'), MAC)).toBeNull();
  });

  it('opens the palette with ⌘K on a Mac and Ctrl+K elsewhere, also in a field', () => {
    expect(keyAction(press('k', { metaKey: true }), MAC)).toBe('palette');
    expect(keyAction(press('k', { metaKey: true }), inField(MAC))).toBe('palette');
    expect(keyAction(press('k', { ctrlKey: true }), WIN)).toBe('palette');
    expect(keyAction(press('k', { ctrlKey: true }), inField(WIN))).toBe('palette');
    // The other platform's modifier is not ours.
    expect(keyAction(press('k', { ctrlKey: true }), MAC)).toBeNull();
    expect(keyAction(press('k', { metaKey: true }), WIN)).toBeNull();
    expect(keyAction(press('k', { metaKey: true, ctrlKey: true }), MAC)).toBeNull();
    expect(keyAction(press('k', { metaKey: true, altKey: true }), MAC)).toBeNull();
    expect(keyAction(press('K', { metaKey: true, shiftKey: true }), MAC)).toBeNull();
  });

  it('opens the next session that needs you with ⌘⇧U, Ctrl+Shift+U or U', () => {
    expect(keyAction(press('U', { metaKey: true, shiftKey: true }), MAC)).toBe('next-needs-you');
    expect(keyAction(press('U', { ctrlKey: true, shiftKey: true }), WIN)).toBe('next-needs-you');
    expect(keyAction(press('u', { metaKey: true }), MAC)).toBeNull();
    expect(keyAction(press('u'), MAC)).toBe('next-needs-you');
    expect(keyAction(press('u'), inField(WIN))).toBeNull();
  });

  it('moves with J and K, answers with A and D, opens with Enter and starts with N', () => {
    for (const context of [MAC, WIN]) {
      expect(keyAction(press('j'), context)).toBe('down');
      expect(keyAction(press('k'), context)).toBe('up');
      expect(keyAction(press('a'), context)).toBe('allow');
      expect(keyAction(press('d'), context)).toBe('deny');
      expect(keyAction(press('Enter'), context)).toBe('open');
      expect(keyAction(press('n'), context)).toBe('new');
      expect(keyAction(press('?', { shiftKey: true }), context)).toBe('help');
      expect(keyAction(press('?'), context)).toBe('help');
      expect(keyAction(press('x'), context)).toBeNull();
    }
  });

  it('leaves single keys alone in a field, a select or a contenteditable', () => {
    for (const key of ['j', 'k', 'a', 'd', 'n', 'u', '?', 'Enter']) {
      expect(keyAction(press(key), inField(MAC))).toBeNull();
      expect(keyAction(press(key), inField(WIN))).toBeNull();
    }
  });

  it('never fires a single key with a modifier held', () => {
    // K with ⌘ (Ctrl) is the palette, checked above.
    for (const key of ['j', 'a', 'd', 'n', 'Enter']) {
      for (const change of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
        expect(keyAction(press(key, change), MAC)).toBeNull();
        expect(keyAction(press(key, change), WIN)).toBeNull();
      }
    }
    expect(keyAction(press('k', { altKey: true }), MAC)).toBeNull();
    expect(keyAction(press('K', { shiftKey: true }), WIN)).toBeNull();
    expect(keyAction(press('?', { altKey: true }), MAC)).toBeNull();
  });

  it('passes Escape on, in a field too, but not with a modifier', () => {
    expect(keyAction(press('Escape'), MAC)).toBe('escape');
    expect(keyAction(press('Escape'), inField(WIN))).toBe('escape');
    expect(keyAction(press('Escape', { metaKey: true }), MAC)).toBeNull();
  });

  it('ignores keys while an input method is composing', () => {
    expect(keyAction(press('k', { metaKey: true, isComposing: true }), MAC)).toBeNull();
    expect(keyAction(press('j', { isComposing: true }), MAC)).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('knows text fields from buttons', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'input', type: 'search' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'ARTICLE' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('keyLabel', () => {
  it('writes keys as each platform shows them', () => {
    expect(keyLabel('mod+k', true)).toBe('⌘K');
    expect(keyLabel('mod+k', false)).toBe('Ctrl+K');
    expect(keyLabel('mod+shift+u', true)).toBe('⌘⇧U');
    expect(keyLabel('mod+shift+u', false)).toBe('Ctrl+Shift+U');
    expect(keyLabel('enter', true)).toBe('↩');
    expect(keyLabel('enter', false)).toBe('Enter');
    expect(keyLabel('escape', true)).toBe('Esc');
    expect(keyLabel('j', false)).toBe('J');
    expect(keyLabel('up', true)).toBe('↑');
    expect(keyLabel('?', false)).toBe('?');
  });

  it('lists every key the handler knows', () => {
    const listed = new Set(KEY_LIST.map((k) => k.action));
    for (const action of ['palette', 'next-needs-you', 'sidebar', 'down', 'up', 'allow', 'deny', 'open', 'new', 'escape', 'help'] as const) expect(listed).toContain(action);
  });
});

describe('nextIndex', () => {
  it('starts at the first or the last, then steps and stops at the ends', () => {
    expect(nextIndex(-1, 3, 1)).toBe(0);
    expect(nextIndex(-1, 3, -1)).toBe(2);
    expect(nextIndex(0, 3, 1)).toBe(1);
    expect(nextIndex(2, 3, 1)).toBe(2);
    expect(nextIndex(0, 3, -1)).toBe(0);
    expect(nextIndex(0, 0, 1)).toBe(-1);
  });
});

describe('inView', () => {
  it('is true only when the whole box shows', () => {
    expect(inView({ top: 100, bottom: 130 }, { top: 0, bottom: 800 })).toBe(true);
    expect(inView({ top: 790, bottom: 820 }, { top: 0, bottom: 800 })).toBe(false);
    expect(inView({ top: -20, bottom: 10 }, { top: 0, bottom: 800 })).toBe(false);
    expect(inView({ top: 0, bottom: 0 }, { top: 0, bottom: 800 })).toBe(false);
  });
});
