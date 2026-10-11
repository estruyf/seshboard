/**
 * The site shows every key for macOS and for Windows, and CSS keeps the reader's one (`data-os` on <html>, set in
 * overrides/ThemeProvider.astro, changed with the switch in the header). The app's shortcut helpers read the
 * platform from `window.switchboard.platform` when called, so at build time each key is rendered once per platform
 * by pretending to be that window for the length of a synchronous call.
 */
export type Os = 'mac' | 'windows';

export const OSES: readonly Os[] = ['mac', 'windows'];

const PLATFORM: Record<Os, string> = { mac: 'darwin', windows: 'win32' };

/** `fn()` as it runs in the app on `os`. */
export function asOs<T>(os: Os, fn: () => T): T {
  const scope = globalThis as { window?: unknown };
  const before = scope.window;
  scope.window = { switchboard: { platform: PLATFORM[os] } };
  try {
    return fn();
  } finally {
    if (before === undefined) delete scope.window;
    else scope.window = before;
  }
}
