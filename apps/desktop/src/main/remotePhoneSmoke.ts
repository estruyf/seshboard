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
  // A session or New session (with a sheet over it, maybe): the list again, from a reload on its history entry.
  if (await js("Boolean(document.querySelector('[data-remote-session-view], [data-remote-new-session]'))")) {
    await js("history.replaceState({ kind: 'list' }, ''); location.reload()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-computer-title][data-remote-connection=\"connected\"]')", 15_000))) return 'the phone did not come back to Home';
  }
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

/** Opens the demo's finished session from Home ("Add rate limits to the webhooks"), on its catch-up. */
async function openFinished(js: (code: string) => Promise<unknown>, win: BrowserWindow): Promise<string | null> {
  await js("[...document.querySelectorAll('[data-remote-list] [data-remote-session]')].find((row) => row.innerText.startsWith('Add rate limits'))?.click()");
  if (!(await waitInPage(win, "document.querySelector('[data-remote-session-view]')", 3_000))) return 'the finished session did not open';
  if (!(await waitInPage(win, "document.querySelector('[data-remote-catchup-title]')", 5_000))) return 'the finished session has no catch-up';
  return null;
}

/** A finished session's catch-up says what you asked as the prompt's title, without its Markdown `#`. */
export function runPhoneCatchUpStep(): Promise<string> {
  return onPhone(async (js, win) => {
    const failed = await openFinished(js, win);
    if (failed) return failed;
    const title = (await js("document.querySelector('[data-remote-catchup-title]').textContent")) as string;
    if (title.includes('#')) return `the catch-up shows the prompt's Markdown: "${title}"`;
    if (title !== 'Rate limits for the webhooks') return `the catch-up's title is "${title}", not the prompt's heading`;
    await js("document.querySelector('[data-remote-catchup-prompt]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-sheet=\"prompt\"] h1, [data-remote-sheet=\"prompt\"] h2')", 3_000))) return 'Show the prompt did not show it as Markdown';
    return `ok: "${title}", and Show the prompt renders the whole prompt`;
  });
}

/** A session's header has no ? button: Ask about this session is the first row of its round ⋯. */
export function runPhoneSessionMoreStep(): Promise<string> {
  return onPhone(async (js, win) => {
    const failed = await openFinished(js, win);
    if (failed) return failed;
    if (await js("Boolean(document.querySelector('[data-remote-session-view] [data-remote-ask]'))")) return 'the header still has the ? button';
    await js("document.querySelector('[data-remote-session-more]').click()");
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-remote-menu-item]')", 3_000))) return '⋯ did not open';
    const items = (await js("[...document.querySelectorAll('[role=menu] [data-remote-menu-item]')].map((el) => el.dataset.remoteMenuItem).join(',')")) as string;
    if (!items.startsWith('ask,')) return `⋯ starts with ${items}, not Ask about this session`;
    await js("document.querySelector('[data-remote-session-more]').click()");
    return `ok: ⋯ has ${items.replaceAll(',', ', ')}`;
  });
}

/** In a session, the drawer's New session opens New session in the session's place: Back goes to the list, not the session. */
export function runPhoneDrawerNewStep(): Promise<string> {
  return onPhone(async (js, win) => {
    const failed = await openFinished(js, win);
    if (failed) return failed;
    await js("document.querySelector('[data-remote-menu-button]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-drawer=\"open\"] [data-remote-drawer-new]')", 3_000))) return 'the drawer has no New session row';
    await js("document.querySelector('[data-remote-drawer-new]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-new-session]') && !document.querySelector('[data-remote-drawer]')", 5_000))) return 'New session did not open from the drawer';
    if ((await js('history.state?.kind')) !== 'new') return 'New session has no history entry';
    await js('history.back()');
    if (!(await waitInPage(win, "document.querySelector('[data-remote-computer-title]') && !document.querySelector('[data-remote-session-view], [data-remote-new-session]')", 3_000))) return 'Back from New session did not go to the list';
    return 'ok: New session from the drawer in a session, and Back went to the list';
  });
}

/** New session from Home's floating pill, with an empty box (a draft from before is cleared). */
async function openNewSession(js: (code: string) => Promise<unknown>, win: BrowserWindow): Promise<string | null> {
  await js("document.querySelector('[data-remote-new-float]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-remote-new-options]')", 10_000))) return 'New session has no Options row';
  await js(TYPE(''));
  return null;
}

/** Types into New session's box the way a person does, so React sees it. */
const TYPE = (text: string) => `(() => {
  const box = document.querySelector('[data-remote-new-prompt]');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

/** New session's Options: another model picked in its sheet shows in the summary, in the accent colour. */
export function runPhoneOptionsStep(): Promise<string> {
  return onPhone(async (js, win) => {
    const failed = await openNewSession(js, win);
    if (failed) return failed;
    if (await js("Boolean(document.querySelector('[data-remote-new-options] [data-remote-summary-changed]'))")) return 'the summary marks a change before anything was picked';
    await js("document.querySelector('[data-remote-new-options]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-sheet=\"options\"] [data-remote-choice=\"model\"]')", 3_000))) return 'the Options sheet has no Model row';
    await js("document.querySelector('[data-remote-sheet=\"options\"] [data-remote-choice=\"model\"]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-remote-sheet=\"choice-model\"] [role=option]')", 3_000))) return 'the Model row did not open its list';
    const picked = (await js(`(() => {
      const option = [...document.querySelectorAll('[data-remote-sheet="choice-model"] [role=option]')].find((o) => o.getAttribute('aria-selected') !== 'true' && !o.innerText.startsWith('Auto'));
      const name = option.innerText.split('\\n')[0];
      option.click();
      return name;
    })()`)) as string;
    if (!(await waitInPage(win, "!document.querySelector('[data-remote-sheet=\"choice-model\"]')", 3_000))) return 'the model list did not close';
    await js("document.querySelector('[data-remote-sheet-done]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-remote-sheet=\"options\"]')", 3_000))) return 'Done did not close Options';
    const changed = (await js("[...document.querySelectorAll('[data-remote-new-options] [data-remote-summary-changed]')].map((el) => el.textContent).join(', ')")) as string;
    if (!changed.includes(picked)) return `the summary doesn't mark ${picked} (marked: ${changed || 'nothing'})`;
    const accent = (await js(`(() => {
      const probe = document.createElement('span');
      probe.className = 'text-accent-ink';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(document.querySelector('[data-remote-new-options] [data-remote-summary-changed]')).color === color;
    })()`)) as boolean;
    if (!accent) return `${picked} is marked but not in the accent colour`;
    return `ok: ${picked} picked in Options shows in the accent colour`;
  });
}

/** Start session is the floating pill: dim with an empty box (still focusable, saying why), ready once there's a task. */
export function runPhoneStartStep(): Promise<string> {
  return onPhone(async (js, win) => {
    const failed = await openNewSession(js, win);
    if (failed) return failed;
    const empty = (await js("(() => { const b = document.querySelector('[data-remote-start]'); return { state: b.dataset.remoteStartState, disabled: b.disabled, label: b.getAttribute('aria-label') }; })()")) as { state: string; disabled: boolean; label: string };
    if (empty.state !== 'empty') return `Start is ${empty.state} with an empty box`;
    if (empty.disabled) return "Start is disabled, so it can't take the focus";
    if (!empty.label.includes('Type a message first')) return `Start says "${empty.label}" with an empty box`;
    await js(TYPE('Add a retry to the upload'));
    if (!(await waitInPage(win, "document.querySelector('[data-remote-start]').dataset.remoteStartState === 'ready'", 2_000))) return 'Start did not get ready with a task in the box';
    // Leave no draft behind for the next run.
    await js(TYPE(''));
    return 'ok: Start dim and saying "Type a message first" while empty, ready with a task';
  });
}
