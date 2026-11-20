import { afterEach, describe, expect, it } from 'vitest';
import { BLURRED_ATTRIBUTE, isWindowActive, watchWindowActivity, type ActivityEnvironment } from './windowActivity.ts';

function page(initial: { main?: boolean; focus?: boolean; visible?: boolean; bridge?: boolean }) {
  const state = { focus: initial.focus ?? true, visibility: initial.visible === false ? 'hidden' : 'visible' };
  const attributes = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const target = (name: string) => listeners.get(name) ?? listeners.set(name, new Set()).get(name)!;
  let bridgeListener: ((active: boolean) => void) | null = null;
  const env: ActivityEnvironment = {
    ...(initial.bridge === false ? {} : { bridge: { windowActive: initial.main ?? true, onWindowActive: (listener: (active: boolean) => void) => ((bridgeListener = listener), () => void (bridgeListener = null)) } }),
    win: { addEventListener: (type, fn) => void target(type).add(fn), removeEventListener: (type, fn) => void target(type).delete(fn) },
    doc: {
      hasFocus: () => state.focus,
      get visibilityState() {
        return state.visibility;
      },
      documentElement: { setAttribute: (name) => void attributes.add(name), removeAttribute: (name) => void attributes.delete(name) },
      addEventListener: (type, fn) => void target(type).add(fn),
      removeEventListener: (type, fn) => void target(type).delete(fn),
    },
  };
  return { state, attributes, env, fire: (type: string) => target(type).forEach((fn) => fn()), main: (active: boolean) => bridgeListener?.(active), listeners };
}

let stop: (() => void) | undefined;
afterEach(() => stop?.());

describe('watchWindowActivity, driven by main', () => {
  it('sets data-blurred when main says the window left the foreground, and clears it when it is back', () => {
    const p = page({ main: false });
    stop = watchWindowActivity(p.env);
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
    expect(isWindowActive()).toBe(false);
    p.main(true);
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(false);
    expect(isWindowActive()).toBe(true);
    p.main(false);
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
  });

  it('ignores the page\'s own focus and blur: focus inside a browser page blurs the page but not the window, and the reverse', () => {
    const p = page({ main: true });
    stop = watchWindowActivity(p.env);
    p.state.focus = false;
    p.fire('blur');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(false);
    // Cmd-Tab away from a browser page: the page saw no blur, main did.
    p.main(false);
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
    p.fire('focus');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
  });

  it('pauses a hidden page whatever main says, and wakes when it shows again', () => {
    const p = page({ main: true });
    stop = watchWindowActivity(p.env);
    p.state.visibility = 'hidden';
    p.fire('visibilitychange');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
    p.state.visibility = 'visible';
    p.fire('visibilitychange');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(false);
  });

  it('tells subscribers once per change', async () => {
    const { isWindowActive: now } = await import('./windowActivity.ts');
    const p = page({ main: true });
    stop = watchWindowActivity(p.env);
    p.main(false);
    p.main(false);
    expect(now()).toBe(false);
    p.main(true);
    expect(now()).toBe(true);
  });

  it('stops watching, and the window counts as active again', () => {
    const p = page({ main: false });
    const off = watchWindowActivity(p.env);
    off();
    expect(isWindowActive()).toBe(true);
    expect(p.attributes.size).toBe(0);
    expect([...p.listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(0);
  });
});

describe('watchWindowActivity without main (a plain browser)', () => {
  it('follows the window\'s focus and blur', () => {
    const p = page({ bridge: false, focus: false });
    stop = watchWindowActivity(p.env);
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
    p.fire('focus');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(false);
    p.fire('blur');
    expect(p.attributes.has(BLURRED_ATTRIBUTE)).toBe(true);
  });
});
