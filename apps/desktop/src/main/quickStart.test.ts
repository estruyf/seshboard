import { describe, expect, it } from 'vitest';
import type { QuickStartStatus } from '@seshboard/protocol/bridge';
import { DRAFT_KEPT_MS, inUseLog, keepsDraft, QUICK_START_HEIGHT, QUICK_START_PAD, QUICK_START_WIDTH, QuickStart, quickStartBounds, toAccelerator, type QuickStartHost } from './quickStart.ts';

describe('the shortcut as an accelerator', () => {
  it('writes the default as Control+Alt+Space on every platform', () => {
    expect(toAccelerator('ctrl+alt+space', 'darwin')).toBe('Control+Alt+Space');
    expect(toAccelerator('ctrl+alt+space', 'win32')).toBe('Control+Alt+Space');
  });

  it('reads mod as ⌘ on macOS and Ctrl elsewhere, and names letters, digits and keys', () => {
    expect(toAccelerator('mod+shift+k', 'darwin')).toBe('Command+Shift+K');
    expect(toAccelerator('mod+shift+k', 'linux')).toBe('Control+Shift+K');
    expect(toAccelerator('cmd+alt+1', 'darwin')).toBe('Command+Alt+1');
    expect(toAccelerator('ctrl+enter', 'win32')).toBe('Control+Return');
    expect(toAccelerator('alt+f5', 'win32')).toBe('Alt+F5');
  });

  it("refuses what can't be a global shortcut", () => {
    expect(toAccelerator('space', 'darwin')).toBeNull();
    expect(toAccelerator('shift+a', 'darwin')).toBeNull();
    expect(toAccelerator('ctrl+alt+§', 'darwin')).toBeNull();
    expect(toAccelerator('hyper+k', 'darwin')).toBeNull();
  });
});

describe('where the panel goes', () => {
  const area = { x: 0, y: 25, width: 1440, height: 1055 };

  const windowWidth = QUICK_START_WIDTH + 2 * QUICK_START_PAD;

  it("is centred across, with the panel's field a third of the way down", () => {
    const bounds = quickStartBounds(area);
    expect(bounds.width).toBe(windowWidth);
    expect(bounds.x).toBe((1440 - windowWidth) / 2);
    expect(bounds.y + QUICK_START_PAD).toBe(25 + Math.round(1055 / 3) - 30);
    expect(bounds.height).toBe(QUICK_START_HEIGHT);
  });

  it('moves up to stay on a short screen, and goes on the screen with the cursor', () => {
    const short = quickStartBounds({ x: 0, y: 0, width: 1280, height: 720 });
    expect(short.y + short.height).toBeLessThanOrEqual(720);
    const right = quickStartBounds({ x: 1440, y: 0, width: 1920, height: 1080 });
    expect(right.x).toBe(1440 + (1920 - windowWidth) / 2);
  });

  it('fits a small screen', () => {
    const small = quickStartBounds({ x: 0, y: 0, width: 640, height: 400 });
    expect(small).toEqual({ x: 0, y: 0, width: 640, height: 400 });
  });
});

describe('the draft', () => {
  it('stays for five minutes after the panel hid', () => {
    expect(keepsDraft(1_000, 1_000 + DRAFT_KEPT_MS - 1)).toBe(true);
    expect(keepsDraft(1_000, 1_000 + DRAFT_KEPT_MS)).toBe(false);
    expect(keepsDraft(null, 5)).toBe(false);
  });
});

function fakeHost(taken: string[] = []) {
  const calls: string[] = [];
  const statuses: QuickStartStatus[] = [];
  const logs: string[] = [];
  let shown = false;
  let now = 0;
  let press: (() => void) | null = null;
  const host: QuickStartHost = {
    platform: 'darwin',
    register: (accelerator, onPress) => {
      calls.push(`register ${accelerator}`);
      if (taken.includes(accelerator)) return false;
      press = onPress;
      return true;
    },
    unregister: (accelerator) => void calls.push(`unregister ${accelerator}`),
    visible: () => shown,
    show: (keepDraft) => {
      shown = true;
      calls.push(`show ${keepDraft}`);
    },
    hide: () => {
      shown = false;
      calls.push('hide');
    },
    log: (message) => void logs.push(message),
    status: (status) => void statuses.push(status),
    now: () => now,
  };
  return { host, calls, statuses, logs, press: () => press?.(), at: (ms: number) => void (now = ms) };
}

describe('QuickStart', () => {
  it('registers the shortcut, and pressing it again closes the panel', () => {
    const fake = fakeHost();
    const quick = new QuickStart(fake.host);
    quick.setShortcut('ctrl+alt+space');
    expect(fake.statuses.at(-1)).toEqual({ shortcut: 'ctrl+alt+space', registered: true });
    fake.press();
    fake.press();
    expect(fake.calls).toEqual(['register Control+Alt+Space', 'show false', 'hide']);
  });

  it('says so when another app has the shortcut, in the status and the log', () => {
    const fake = fakeHost(['Control+Alt+Space']);
    const quick = new QuickStart(fake.host);
    quick.setShortcut('ctrl+alt+space');
    expect(fake.statuses.at(-1)).toEqual({ shortcut: 'ctrl+alt+space', registered: false });
    expect(fake.logs).toEqual([inUseLog('Control+Alt+Space')]);
    expect(quick.status.registered).toBe(false);
  });

  it('moves to a new shortcut, letting the old one go', () => {
    const fake = fakeHost();
    const quick = new QuickStart(fake.host);
    quick.setShortcut('ctrl+alt+space');
    quick.setShortcut('ctrl+alt+space');
    quick.setShortcut('cmd+shift+space');
    expect(fake.calls).toEqual(['register Control+Alt+Space', 'unregister Control+Alt+Space', 'register Command+Shift+Space']);
    quick.dispose();
    expect(fake.calls.at(-1)).toBe('unregister Command+Shift+Space');
  });

  it('keeps the draft when it opens within five minutes of hiding', () => {
    const fake = fakeHost();
    const quick = new QuickStart(fake.host);
    quick.setShortcut('ctrl+alt+space');
    fake.at(10_000);
    quick.open();
    quick.hide();
    fake.at(10_000 + 60_000);
    quick.open();
    quick.hidden();
    fake.at(10_000 + 60_000 + DRAFT_KEPT_MS);
    quick.open();
    expect(fake.calls.filter((c) => c.startsWith('show'))).toEqual(['show false', 'show true', 'show false']);
  });
});
