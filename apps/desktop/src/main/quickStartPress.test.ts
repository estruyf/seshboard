import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUICK_START_READY_TIMEOUT_MS, QuickStartPress, type Press } from './quickStartPress.ts';

type Panel = { id: string };
const A: Panel = { id: 'a' };
const press = (keepDraft = false): Press<string> => ({ keepDraft, bounds: 'screen-1' });

function setup(state: { ready?: boolean; loading?: boolean; visible?: boolean } = {}) {
  const flags = { ready: false, loading: true, visible: false, ...state };
  const calls: string[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  const host = {
    isReady: () => flags.ready,
    isLoading: () => flags.loading,
    isVisible: () => flags.visible,
    prepare: (_p: Panel, p: Press<string>) => void calls.push(`prepare:${p.bounds}`),
    reveal: (_p: Panel, p: Press<string>) => {
      flags.visible = true;
      calls.push(`reveal:${p.keepDraft}`);
    },
    sendShown: (_p: Panel, keepDraft: boolean) => void calls.push(`shown:${keepDraft}`),
    abandon: () => void calls.push('abandon'),
    log: (m: string) => void calls.push(`log:${m.slice(0, 40)}`),
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
  };
  const logic = new QuickStartPress<Panel, string>(host);
  const fire = () => [...timers.values()].forEach((t) => t.run());
  return { logic, calls, flags, timers, fire };
}

afterEach(() => vi.useRealTimers());

describe('QuickStartPress', () => {
  it('shows at once when the panel is ready', () => {
    const t = setup({ ready: true });
    t.logic.press(A, press(true));
    expect(t.calls).toEqual(['prepare:screen-1', 'reveal:true', 'shown:true']);
    expect(t.logic.pending).toBe(false);
    expect(t.timers.size).toBe(0);
  });

  it('waits for the page when the panel was made just now, and shows when the page says it is ready', () => {
    const t = setup();
    t.logic.press(A, press(false));
    // The window is taken at the press, but nothing is revealed yet.
    expect(t.calls).toEqual(['prepare:screen-1']);
    expect(t.logic.pending).toBe(true);
    expect([...t.timers.values()][0]!.ms).toBe(QUICK_START_READY_TIMEOUT_MS);
    t.flags.ready = true;
    t.logic.ready(A);
    expect(t.calls).toEqual(['prepare:screen-1', 'reveal:false', 'shown:false']);
    expect(t.logic.pending).toBe(false);
    expect(t.timers.size).toBe(0);
  });

  it('shows where the cursor was at the press, not where it is when the page is ready', () => {
    const t = setup();
    t.logic.press(A, { keepDraft: false, bounds: 'screen-at-press' });
    t.logic.ready(A);
    expect(t.calls[0]).toBe('prepare:screen-at-press');
  });

  it('takes the press back: nothing shows, and a ready page afterwards shows nothing either', () => {
    const t = setup();
    t.logic.press(A, press());
    t.logic.takeBack();
    expect(t.calls).toEqual(['prepare:screen-1', 'abandon']);
    expect(t.logic.pending).toBe(false);
    expect(t.timers.size).toBe(0);
    t.logic.ready(A);
    expect(t.calls).toEqual(['prepare:screen-1', 'abandon']);
  });

  it('shows after the time when the page has loaded but not said it is ready, and tells the page when it does', () => {
    const t = setup({ loading: false });
    t.logic.press(A, press(true));
    t.fire();
    expect(t.calls).toEqual(['prepare:screen-1', 'reveal:true']);
    expect(t.logic.pending).toBe(false);
    // The late signal reaches the panel that is on screen, with what the press said.
    t.logic.ready(A);
    expect(t.calls.at(-1)).toBe('shown:true');
  });

  it('drops the press, and says so, when the page is still loading after the time', () => {
    const t = setup({ loading: true });
    t.logic.press(A, press());
    t.fire();
    expect(t.calls).toEqual(['prepare:screen-1', expect.stringMatching(/^log:/), 'abandon']);
    expect(t.logic.pending).toBe(false);
    // The panel was never shown: its page being ready later does not show anything.
    t.logic.ready(A);
    expect(t.calls.some((c) => c.startsWith('reveal') || c.startsWith('shown'))).toBe(false);
  });

  it('forgets a press when the panel closes during the wait', () => {
    const t = setup();
    t.logic.press(A, press());
    t.logic.closed(A);
    expect(t.logic.pending).toBe(false);
    expect(t.timers.size).toBe(0);
    t.fire();
    expect(t.calls).toEqual(['prepare:screen-1']);
  });

  it('keeps one waiting press: a second press replaces the first', () => {
    const t = setup();
    t.logic.press(A, press(false));
    t.logic.press(A, press(true));
    expect(t.timers.size).toBe(1);
    t.logic.ready(A);
    expect(t.calls.filter((c) => c.startsWith('reveal'))).toEqual(['reveal:true']);
  });
});
