import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { trackWindowActivity, windowIsActive, type ActivityWindow } from './windowActivity.ts';

function fakeWindow(initial: Partial<{ visible: boolean; minimized: boolean; focused: boolean; destroyed: boolean }> = {}) {
  const state = { visible: true, minimized: false, focused: true, destroyed: false, ...initial };
  const events = new EventEmitter();
  const win: ActivityWindow = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    isFocused: () => state.focused,
    on: (event, listener) => events.on(event, listener),
  };
  return { win, state, emit: (event: string) => events.emit(event) };
}

describe('windowIsActive', () => {
  it('is a shown, unminimised, focused window', () => {
    expect(windowIsActive(fakeWindow().win)).toBe(true);
    expect(windowIsActive(fakeWindow({ focused: false }).win)).toBe(false);
    expect(windowIsActive(fakeWindow({ visible: false }).win)).toBe(false);
    expect(windowIsActive(fakeWindow({ minimized: true }).win)).toBe(false);
    expect(windowIsActive(fakeWindow({ destroyed: true }).win)).toBe(false);
  });
});

describe('trackWindowActivity', () => {
  it('sends a change once, for every event that can cause one', () => {
    const w = fakeWindow();
    const sent: boolean[] = [];
    trackWindowActivity(w.win, (active) => sent.push(active));
    // Cmd-Tab away: blur.
    w.state.focused = false;
    w.emit('blur');
    w.emit('hide');
    expect(sent).toEqual([false]);
    w.state.focused = true;
    w.emit('focus');
    expect(sent).toEqual([false, true]);
    // Minimised and restored, hidden and shown.
    w.state.minimized = true;
    w.emit('minimize');
    w.state.minimized = false;
    w.emit('restore');
    w.state.visible = false;
    w.emit('hide');
    w.state.visible = true;
    w.emit('show');
    expect(sent).toEqual([false, true, false, true, false, true]);
  });

  it('starts from the window as it is: a panel shown without focus is not active until it gets it', () => {
    const w = fakeWindow({ focused: false });
    const sent: boolean[] = [];
    trackWindowActivity(w.win, (active) => sent.push(active));
    w.emit('show');
    expect(sent).toEqual([]);
    w.state.focused = true;
    w.emit('focus');
    expect(sent).toEqual([true]);
  });
});
