import type { BrowserWindow } from 'electron';

// Drives the renderer like a user would, for the smoke test and the README screenshots.

/** Polls a condition in the renderer. Often: most conditions hold within a frame or two, and every poll is one cheap IPC. */
export async function waitInPage(win: Pick<BrowserWindow, 'webContents'>, expression: string, timeoutMs = 10_000): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** Polls a condition in the main process (a saved preference, a file on disk). */
export async function until(check: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

/**
 * Waits until the page has stopped moving: no finite CSS transition or animation still running (a sidebar
 * sliding open, a panel docking), then one more painted frame. Endless ones (spinners, pulsing dots) don't count.
 * Use it instead of a fixed pause before a measurement or a screenshot.
 */
export function settle(win: BrowserWindow, timeoutMs = 2_000): Promise<unknown> {
  return win.webContents.executeJavaScript(`new Promise((resolve) => {
    const end = performance.now() + ${timeoutMs};
    const moving = () => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
    // requestAnimationFrame stops while the window is hidden; the timer makes sure this still ends.
    const fallback = setTimeout(() => resolve(false), ${timeoutMs + 200});
    const tick = () => {
      if (moving() && performance.now() < end) return requestAnimationFrame(tick);
      requestAnimationFrame(() => { clearTimeout(fallback); resolve(true); });
    };
    requestAnimationFrame(tick);
  })`);
}

/** Sets a React-controlled field the way a user would, so onChange fires. */
export function setFieldValue(win: BrowserWindow, selector: string, value: string): Promise<unknown> {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
}
