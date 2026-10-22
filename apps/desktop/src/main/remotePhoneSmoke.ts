import { existsSync, readFileSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import { until, waitInPage } from './pageDriver.ts';

/**
 * The smoke steps of the remote app on a phone: the real app from apps/remote, served by Vite, in a hidden 390×844
 * window with a throwaway session of its own, paired with a made-up computer (scripts/remote-demo.ts, "Phone Mac").
 * The smoke script starts both and writes the computer's pairing links to `SWITCHBOARD_SMOKE_PHONE_LINK`. The window
 * pairs once, for the first step that needs it, so each step also runs on its own with `--only`. Nothing here
 * touches real data: the computer is made up, and the window has no preload.
 */

let phone: Promise<BrowserWindow | string> | null = null;

/** The paired phone, on Home; a string when it couldn't get there. */
function remotePhone(): Promise<BrowserWindow | string> {
  phone ??= openPhone().then((result) => {
    // A failed pairing is tried again by the next step rather than failing it too.
    if (typeof result === 'string') phone = null;
    return result;
  });
  return phone;
}

async function openPhone(): Promise<BrowserWindow | string> {
  const linkFile = process.env.SWITCHBOARD_SMOKE_PHONE_LINK;
  if (!linkFile) return 'ok: skipped, no remote app to drive (run through npm run smoke)';
  if (!(await until(() => existsSync(linkFile), 20_000))) return "the phone's computer wrote no pairing link";
  const win = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { partition: `smoke-phone-${Date.now()}`, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadURL(readFileSync(linkFile, 'utf8').trim());
    // Vite compiles the app on the first load: this can take a while on a fresh runner.
    if (!(await waitInPage(win, "[...document.querySelectorAll('button')].some((b) => b.textContent === 'Pair')", 30_000))) return 'the remote app did not show Pair';
    await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Pair').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-computer-title][data-remote-connection=\"connected\"]')", 20_000))) {
      return `the phone did not connect: ${await win.webContents.executeJavaScript("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160)")}`;
    }
    return win;
  } catch (error) {
    win.destroy();
    return `the remote app did not load: ${(error as Error).message}`;
  }
}

/** Runs a step on the paired phone, back on Home first (a step before may have left a page or the drawer open). */
async function onPhone(run: (js: (code: string) => Promise<unknown>, win: BrowserWindow) => Promise<string>): Promise<string> {
  const win = await remotePhone();
  if (typeof win === 'string') return win;
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js("document.querySelector('[data-remote-drawer-close]')?.click(); document.querySelector('[data-remote-settings-back]')?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-remote-menu-button]') && !document.querySelector('[data-remote-drawer]') && !document.querySelector('[data-remote-settings]')", 5_000))) return 'the phone is not back on Home';
  return run(js, win);
}

/** How light the page's background is (0 black, 1 white). */
const LIGHTNESS = "(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return (r + g + b) / 765; })()";

/**
 * Home has the round menu button at its top left; a tap opens the drawer ("Menu"), which starts with the search and has
 * no app icon, with Settings and the computer pinned to its bottom.
 */
export function runPhoneDrawerStep(): Promise<string> {
  return onPhone(async (js, win) => {
    await js("document.querySelector('[data-remote-menu-button]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-drawer=\"open\"] [data-remote-drawer-panel]')", 3_000))) return 'the menu button did not open the drawer';
    const drawer = (await js(`(() => {
      const panel = document.querySelector('[data-remote-drawer-panel]');
      const bottom = panel.getBoundingClientRect().bottom;
      const settings = panel.querySelector('[data-remote-drawer-settings]');
      const computer = panel.querySelector('[data-remote-drawer-computer]');
      return {
        label: panel.getAttribute('aria-label'),
        icon: Boolean(panel.querySelector('img')),
        search: Boolean(panel.querySelector('[data-remote-search]')),
        settings: settings ? Math.round(bottom - settings.getBoundingClientRect().bottom) : null,
        computer: computer ? computer.innerText.replace(/\\s+/g, ' ') : null,
        nearBottom: computer ? bottom - computer.getBoundingClientRect().bottom < 60 : false,
      };
    })()`)) as { label: string; icon: boolean; search: boolean; settings: number | null; computer: string | null; nearBottom: boolean };
    if (drawer.label !== 'Menu') return `the drawer is labelled "${drawer.label}", not "Menu"`;
    if (drawer.icon) return 'the drawer still shows the app icon';
    if (!drawer.search) return 'the drawer has no search';
    if (drawer.settings === null) return 'the drawer has no Settings row';
    if (!drawer.computer || !drawer.nearBottom) return 'the computer row is not at the bottom of the drawer';
    if (!drawer.computer.includes('Phone Mac')) return `the computer row says "${drawer.computer}"`;
    await js("document.querySelector('[data-remote-drawer-close]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-remote-drawer]')", 3_000))) return '× did not close the drawer';
    return `ok: drawer "Menu" with search, no app icon, Settings and "${drawer.computer}" at the bottom`;
  });
}

/** Picks Light or Dark on the Settings page, goes Back, and says whether Home shows in it. Null when it does. */
async function themeRoundTrip(js: (code: string) => Promise<unknown>, win: BrowserWindow, mode: 'light' | 'dark'): Promise<string | null> {
  await js(`document.querySelector('[data-remote-settings] [data-remote-theme-mode-option="${mode}"]').click()`);
  if (!(await waitInPage(win, `document.documentElement.dataset.mode === '${mode}'`, 2_000))) return `${mode} did not apply`;
  await js('history.back()');
  if (!(await waitInPage(win, "!document.querySelector('[data-remote-settings]') && document.querySelector('[data-remote-computer-title]')", 3_000))) return 'Back did not return to Home';
  const lightness = (await js(LIGHTNESS)) as number;
  return (mode === 'light') === lightness > 0.5 ? null : `Home is not ${mode} (lightness ${lightness.toFixed(2)})`;
}

/** Settings, from the drawer: Dark, Back to Home in dark; then Light, Back to Home in light. */
export function runPhoneSettingsThemeStep(): Promise<string> {
  return onPhone(async (js, win) => {
    for (const mode of ['dark', 'light'] as const) {
      await js("document.querySelector('[data-remote-menu-button]').click()");
      if (!(await waitInPage(win, "document.querySelector('[data-remote-drawer=\"open\"] [data-remote-drawer-settings]')", 3_000))) return 'the drawer did not open';
      await js("document.querySelector('[data-remote-drawer-settings]').click()");
      if (!(await waitInPage(win, "document.querySelector('[data-remote-settings]') && !document.querySelector('[data-remote-drawer]')", 3_000))) return 'Settings did not open from the drawer';
      if ((await js("history.state?.kind")) !== 'settings') return 'Settings has no history entry of its own';
      const failed = await themeRoundTrip(js, win, mode);
      if (failed) return failed;
    }
    // Back as it was: the phone's own light or dark.
    await js("document.querySelector('[data-remote-more]').click()");
    await waitInPage(win, "document.querySelector('[data-remote-menu-item=\"theme\"] [data-remote-menu-option=\"system\"]')", 2_000);
    // Picking keeps the menu open; its button closes it again.
    await js("document.querySelector('[data-remote-menu-option=\"system\"]')?.click(); document.querySelector('[data-remote-more]').click()");
    return 'ok: Settings from the drawer, Dark then Light, and Home followed after Back each time';
  });
}

/** Home's ⋯ has the quick settings, and All settings opens the Settings page. */
export function runPhoneMoreStep(): Promise<string> {
  return onPhone(async (js, win) => {
    await js("document.querySelector('[data-remote-more]').click()");
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-remote-menu-item=\"settings\"]')", 3_000))) return '⋯ has no All settings';
    const items = (await js("[...document.querySelectorAll('[role=menu] [data-remote-menu-item]')].map((el) => el.dataset.remoteMenuItem).join(',')")) as string;
    if (items !== 'theme,notifications,refresh,settings') return `⋯ has ${items}`;
    if ((await js("document.querySelectorAll('[role=menu] [data-remote-menu-item=\"theme\"] [role=menuitemradio]').length")) !== 3) return 'Theme in ⋯ has no Auto, Dark and Light';
    await js("document.querySelector('[data-remote-menu-item=\"settings\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-settings]')", 3_000))) return 'All settings did not open Settings';
    await js('history.back()');
    if (!(await waitInPage(win, "!document.querySelector('[data-remote-settings]')", 3_000))) return 'Back did not leave Settings';
    return `ok: ⋯ has ${items.replaceAll(',', ', ')}; All settings opened Settings`;
  });
}

/** Closes the phone's window, at the end of the run. */
export async function closeRemotePhone(): Promise<void> {
  const win = await phone;
  if (win && typeof win !== 'string') win.destroy();
  phone = null;
}
