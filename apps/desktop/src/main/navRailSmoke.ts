import type { BrowserWindow } from 'electron';
import { settle, setFieldValue, waitInPage } from './pageDriver.ts';
import { platformModifiers } from './smokeKeys.ts';

// The smoke steps for the main window's title bar, the nav rail at its left edge and the panel beside it. They open
// and close the panel, open sessions and pages, and change only the throwaway profile's preferences, each put back as
// it was. The stand-in that needs you is a made-up host in a temp folder (`MinimalSmoke.host`).

const js = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);
const STATE = "document.querySelector('[data-sidebar]')?.dataset.sidebarState";
const RAIL = 'nav[aria-label="Views"]';
const item = (id: string) => `document.querySelector('${RAIL} [data-nav-item="${id}"]')`;
const DEFAULT_ORDER = ['home', 'sessions', 'upcoming', 'activity', 'browser', 'projects', 'computers', 'running'];

/** What the steps need from main. */
export interface NavRailSmoke {
  shot(name: string): Promise<void>;
  prefs(): { minimalMode: boolean; browserEnabled: boolean; navRailOrder: string[]; navRailHidden: string[] };
  update(patch: Record<string, unknown>): void;
  /** A stand-in session in a temp folder: waiting on a made-up prompt, or gone. */
  host(sessionId: string, cwd: string, state: 'running' | 'needs-you' | 'closed'): void;
  tempFolder(): { path: string; remove(): void };
  /** Writes a key of the engine's app state, as the window saves it. */
  setAppState(key: string, value: unknown): void;
  /** Reloads the window (its ready report is expected). */
  reload(): void;
  /** Where the traffic lights sit (macOS), or null elsewhere. */
  windowButtons(): { x: number; y: number } | null;
  /** The session the steps start from, and the ones running in Claude Code right now (never opened here). */
  sessionId: string | null;
  running(): Promise<Set<string>>;
}

function press(win: BrowserWindow, keyCode: string, modifiers: Array<'meta' | 'shift' | 'alt' | 'control'> = []): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: platformModifiers(modifiers) });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: platformModifiers(modifiers) });
}

/** ⌘B from the window, not from the terminal (on Windows its Ctrl keys are the shell's). */
async function toggleKey(win: BrowserWindow): Promise<void> {
  await js(win, "document.activeElement?.closest('.xterm, input, textarea') && document.activeElement.blur()");
  win.focus();
  press(win, 'B', ['meta']);
}

/** The panel open or closed, by ⌘B; false when it did not get there. */
async function panelTo(win: BrowserWindow, state: 'open' | 'closed'): Promise<boolean> {
  if ((await js(win, STATE)) === state) return true;
  await toggleKey(win);
  return waitInPage(win, `${STATE} === '${state}'`, 3_000);
}

/** Back on the session the steps start from, with Settings and any popover closed. */
async function home(win: BrowserWindow, deps: NavRailSmoke): Promise<void> {
  await js(win, "document.querySelector('[data-close-settings]')?.click()");
  // The panel on the sessions, open, as every step starts.
  if (!(await js(win, "document.querySelector('[data-sidebar-open]') && document.querySelector('[data-sidebar-sessions=shown]')"))) {
    await js(win, `${item('sessions')}?.click()`);
    await waitInPage(win, "document.querySelector('[data-sidebar-sessions=shown]') && document.querySelector('[data-session-list] [data-session-id]')", 3_000);
  }
  if (deps.sessionId) await js(win, `document.querySelector('[data-session-id=${JSON.stringify(deps.sessionId)}]')?.click()`);
  await settle(win);
}

/** Two sessions of the list that aren't running in Claude Code, the start session first when it is listed. */
async function twoSessions(win: BrowserWindow, deps: NavRailSmoke): Promise<string[]> {
  const running = await deps.running();
  const ids = (await js(win, "[...document.querySelectorAll('[data-session-list] [data-session-id]')].map((r) => r.dataset.sessionId)")) as string[];
  const free = ids.filter((id) => !running.has(id) && !id.startsWith('run:'));
  const start = deps.sessionId && free.includes(deps.sessionId) ? [deps.sessionId] : [];
  return [...start, ...free.filter((id) => id !== deps.sessionId)].slice(0, 2);
}

/** nav rail: state. ⌘B closes and opens the panel; a stored 'minimal' (the old 80px rail) loads as closed. */
export async function runNavRailStateStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  if (!(await panelTo(win, 'open'))) return `the panel did not start open (${String(await js(win, STATE))})`;
  const width = (await js(win, "Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width)")) as number;
  await toggleKey(win);
  if (!(await waitInPage(win, `${STATE} === 'closed' && !document.querySelector('[data-sidebar-open]')`, 3_000))) return '⌘B did not close the panel';
  await toggleKey(win);
  if (!(await waitInPage(win, `${STATE} === 'open' && document.querySelector('[data-sidebar-open]')`, 3_000))) return '⌘B did not open the panel again';
  await settle(win);

  // The window saves its state a moment after a change: wait for that, then put the old rail's state there and reload.
  await new Promise((resolve) => setTimeout(resolve, 500));
  deps.setAppState('ui.sidebar', { width, state: 'minimal' });
  deps.reload();
  const closed = await waitInPage(win, `${STATE} === 'closed' && document.querySelector('${RAIL}')`, 15_000);
  const got = String(await js(win, STATE));
  // Opened again for the steps after this one, at the width it had.
  await waitInPage(win, "document.querySelector('[data-session-list], [data-nav-rail]')", 10_000);
  await panelTo(win, 'open');
  await waitInPage(win, "document.querySelector('[data-session-list] [data-session-id]')", 10_000);
  await home(win, deps);
  if (!closed) return `a stored 'minimal' state loaded as ${got}, not closed`;
  return `ok: ⌘B closed and opened the panel (${width}px), a stored 'minimal' loaded as closed`;
}

/**
 * title bar: 40px across the window, its search opens Go to, the traffic lights centred in it (macOS), and Back returns
 * to the session open before a second one.
 */
export async function runTitleBarStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  const bar = (await js(win, "(() => { const r = document.querySelector('[data-title-bar]')?.getBoundingClientRect(); return r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), window: window.innerWidth } : null; })()")) as { top: number; left: number; width: number; height: number; window: number } | null;
  if (!bar) return 'the window has no title bar';
  if (bar.height !== 40 || bar.top !== 0 || bar.left !== 0 || bar.width !== bar.window) return `the title bar is not 40px across the window (${JSON.stringify(bar)})`;

  // The search field is a button that opens Go to.
  await js(win, "document.querySelector('[data-title-bar] [data-title-search]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-command-palette]')?.dataset.paletteMode === 'goto'", 3_000))) return 'the search field did not open Go to';
  press(win, 'Escape');
  if (!(await waitInPage(win, "!document.querySelector('[data-command-palette]')", 3_000))) return 'Escape did not close Go to';

  // macOS: the traffic lights' centre line is the bar's (they are 14px tall; the bar's centre is 20px down).
  const lights = deps.windowButtons();
  let centred = 'no traffic lights here';
  if (lights) {
    const centre = lights.y + 7;
    if (Math.abs(centre - bar.height / 2) > 1) return `the traffic lights are not centred in the bar (their centre at ${centre}px, the bar's at ${bar.height / 2}px)`;
    centred = `traffic lights centred at ${centre}px`;
  }

  // Back: open one session, then another, and Back shows the first again.
  const [first, second] = await twoSessions(win, deps);
  let back = 'fewer than two sessions, so Back was not checked';
  if (first && second) {
    const shown = (id: string) => `document.querySelector('[data-current-session=${JSON.stringify(id)}]')`;
    await js(win, `document.querySelector('[data-session-list] [data-session-id=${JSON.stringify(first)}]').click()`);
    if (!(await waitInPage(win, shown(first), 5_000))) return 'the first session did not open';
    // A place left at once is only passed through (`PASSING_MS`): stay a moment before the next one.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await js(win, `document.querySelector('[data-session-list] [data-session-id=${JSON.stringify(second)}]').click()`);
    if (!(await waitInPage(win, `${shown(second)} && !document.querySelector('[data-title-bar] [data-title-back]').disabled`, 5_000))) return 'after a second session Back is not enabled';
    await js(win, "document.querySelector('[data-title-bar] [data-title-back]').click()");
    if (!(await waitInPage(win, shown(first), 3_000))) return 'Back did not return to the first session';
    if (!(await waitInPage(win, "!document.querySelector('[data-title-bar] [data-title-forward]').disabled", 2_000))) return 'after Back, Forward is not enabled';
    back = 'Back returned to the first session, Forward came on';
  }
  await home(win, deps);
  await deps.shot('title-bar.png');
  return `ok: 40px across the window, the search opens Go to, ${centred}, ${back}`;
}

/** nav rail: layout. 52px, the items in the default order, the Needs you count on Sessions, Upcoming as a page. */
export async function runNavRailLayoutStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  await panelTo(win, 'open');
  const rail = (await js(win, `(() => { const r = document.querySelector('${RAIL}'); return r ? { width: Math.round(r.getBoundingClientRect().width), first: r.querySelector('[data-nav-button]')?.hasAttribute('data-new-session'), last: [...r.querySelectorAll('[data-nav-button]')].at(-1)?.hasAttribute('data-open-settings'), items: [...r.querySelectorAll('[data-nav-item]')].map((b) => b.dataset.navItem).filter((id) => id !== 'settings') } : null; })()`)) as { width: number; first: boolean; last: boolean; items: string[] } | null;
  if (!rail) return 'the window has no nav rail';
  if (rail.width !== 52) return `the nav rail is ${rail.width}px wide, not 52`;
  if (!rail.first || !rail.last) return 'the nav rail does not start with New session and end with Settings';
  const expected = DEFAULT_ORDER.filter((id) => rail.items.includes(id));
  if (JSON.stringify(rail.items) !== JSON.stringify(expected) || !['home', 'sessions', 'upcoming', 'activity', 'projects'].every((id) => rail.items.includes(id))) return `the items are not in the default order (${rail.items.join(', ')})`;

  // A stand-in that needs you: its count on Sessions.
  const folder = deps.tempFolder();
  const waiting = `smoke-nav-wait-${Date.now()}`;
  try {
    deps.host(waiting, folder.path, 'needs-you');
    const badge = `${item('sessions')}?.querySelector('[data-needs-you-pill]')`;
    if (!(await waitInPage(win, `Number(${badge}?.dataset.needsYouPill) >= 1 && /\\d/.test(${badge}.textContent)`, 8_000))) return `Sessions shows no Needs you count (${String(await js(win, `${badge}?.outerHTML ?? 'no badge'`))})`;
    const count = (await js(win, `${badge}.textContent`)) as string;
    if (!/need/.test((await js(win, `${item('sessions')}.getAttribute('aria-label')`)) as string)) return "Sessions' name does not say what needs you";
    await deps.shot('nav-rail.png');

    // Every item but Home shows its list in the panel, with its page in the main area: Upcoming and Activity their
    // project filters, Settings its sections. Each is then the selected item.
    const shows = async (id: string, panel: string, page: string) => {
      await js(win, `${item(id)}.click()`);
      return waitInPage(win, `document.querySelector(${JSON.stringify(page)}) && document.querySelector(${JSON.stringify(`[data-sidebar-open] ${panel}`)}) && ${item(id)}.getAttribute('aria-pressed') === 'true' && ${item(id)}.querySelector('[data-nav-current]')`, 3_000);
    };
    if (!(await shows('upcoming', '[data-panel-filters="upcoming"] [data-panel-filter="all"]', '[data-upcoming]'))) return 'Upcoming did not open its page with its project filter in the panel';
    if (!(await shows('activity', '[data-panel-filters="activity"] [data-panel-filter="all"]', '[data-activity]'))) return 'Activity did not open its page with its project filter in the panel';
    await js(win, `document.querySelector('[data-open-settings]').click()`);
    if (!(await waitInPage(win, "document.querySelector('[data-settings]') && document.querySelector('[data-sidebar-open] [data-settings-nav=\"panel\"] [data-settings-section]') && !document.querySelector('[data-settings] [data-settings-nav]')", 3_000))) return 'Settings did not put its sections in the panel';
    await js(win, "document.querySelector('[data-close-settings]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-settings]') && document.querySelector('[data-sidebar-open] [data-panel-filters=\"activity\"]')", 3_000))) return 'closing Settings did not bring back the page it covered and its list';
    return `ok: 52px, ${rail.items.join(', ')} between New session and Settings, ${count} on Sessions, Upcoming and Activity with their project filters in the panel, Settings with its sections there`;
  } finally {
    deps.host(waiting, folder.path, 'closed');
    folder.remove();
    await home(win, deps);
  }
}

/**
 * nav rail: panel. Its header (Sessions, the project, View and the filter button), the filter shown, typed in and
 * cleared with Escape, Sessions closing and opening the panel, and Browser switching its list.
 */
export async function runNavRailPanelStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  await panelTo(win, 'open');
  const header = '[data-sidebar-open] [data-panel-header]';
  const parts = (await js(win, `(() => { const h = document.querySelector('${header}'); return h ? { title: h.querySelector('h2')?.textContent, project: !!h.querySelector('[data-project-filter]'), view: !!h.querySelector('[data-sidebar-view]'), filter: !!h.querySelector('[data-filter-toggle]') } : null; })()`)) as { title: string; project: boolean; view: boolean; filter: boolean } | null;
  if (!parts) return 'the panel has no header';
  if (parts.title !== 'Sessions' || !parts.view || !parts.filter || (!parts.project && !deps.prefs().minimalMode)) return `the header is missing something (${JSON.stringify(parts)})`;

  // The filter: hidden until its button, then typing narrows the list, and Escape clears and hides it.
  if (await js(win, "!!document.querySelector('[data-session-filter]')")) return 'the filter shows before its button was pressed';
  await js(win, `document.querySelector('${header} [data-filter-toggle]').click()`);
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-session-filter]')", 2_000))) return 'the filter button did not show and focus the field';
  const rows = "document.querySelectorAll('[data-session-list] [data-session-id]').length";
  const before = (await js(win, rows)) as number;
  await setFieldValue(win, '[data-session-filter]', 'zz-no-such-session-zz');
  if (!(await waitInPage(win, `${rows} === 0`, 3_000))) return `typing in the filter did not narrow the list (${String(await js(win, rows))} of ${before} rows)`;
  await js(win, "document.querySelector('[data-session-filter]').focus()");
  press(win, 'Escape');
  if (!(await waitInPage(win, `!document.querySelector('[data-session-filter]') && ${rows} === ${before}`, 3_000))) return 'Escape did not clear and hide the filter';

  // Sessions on the rail: open, it closes the panel; again, it opens it.
  await js(win, `${item('sessions')}.click()`);
  if (!(await waitInPage(win, `${STATE} === 'closed'`, 3_000))) return 'Sessions with the panel open did not close it';
  await js(win, `${item('sessions')}.click()`);
  if (!(await waitInPage(win, `${STATE} === 'open' && ${item('sessions')}.getAttribute('aria-pressed') === 'true'`, 3_000))) return 'Sessions with the panel closed did not open it';

  // Projects shows its list in the panel and a project's page beside it; Sessions switches back, the page staying.
  await js(win, `${item('projects')}.click()`);
  if (!(await waitInPage(win, `document.querySelector('[data-sidebar-open] [data-panel-projects] [data-project-list]') && document.querySelector('[data-projects-view]') && !document.querySelector('[data-projects-view] [data-project-list]') && ${item('projects')}.hasAttribute('data-selected') && ${item('projects')}.querySelector('[data-nav-current]')`, 3_000))) return 'Projects did not show its list in the panel beside the project page';
  await js(win, `${item('sessions')}.click()`);
  if (!(await waitInPage(win, `document.querySelector('${header} h2')?.textContent === 'Sessions' && document.querySelector('[data-projects-view]') && ${item('sessions')}.querySelector('[data-nav-current]') && !${item('projects')}.querySelector('[data-nav-current]')`, 3_000))) return 'Sessions did not switch the panel back from the projects';
  // Home is an action: never the selected item.
  await js(win, `${item('home')}.click()`);
  if (!(await waitInPage(win, `!document.querySelector('[data-projects-view]') && !${item('home')}.hasAttribute('data-selected') && ${item('sessions')}.querySelector('[data-nav-current]')`, 3_000))) return 'Home looks selected, or Sessions does not';

  // Settings from Home, and Settings again: Settings closes, Home is back with the sessions in the panel.
  await js(win, "document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, "document.querySelector('[data-settings]') && document.querySelector('[data-sidebar-open] [data-settings-nav]')", 3_000))) return 'Settings did not open with its sections in the panel';
  await js(win, "document.querySelector('[data-open-settings]').click()");
  if (!(await waitInPage(win, `!document.querySelector('[data-settings]') && document.querySelector('[data-sidebar-sessions=shown]') && ${item('sessions')}.querySelector('[data-nav-current]')`, 3_000)))
    return `Settings twice did not come back to the sessions (${String(await js(win, "JSON.stringify({ settings: !!document.querySelector('[data-settings]'), state: document.querySelector('[data-sidebar]')?.dataset.sidebarState, sessions: document.querySelector('[data-sidebar-sessions]')?.dataset.sidebarSessions, view: document.querySelector('[data-panel-view]')?.dataset.panelView ?? null })"))})`;

  // Browser switches the list, and Sessions switches back.
  const browserWas = deps.prefs().browserEnabled;
  if (!browserWas) deps.update({ browserEnabled: true });
  try {
    if (!(await waitInPage(win, `!!${item('browser')}`, 3_000))) return 'Browser is not on the rail with the browser on';
    await js(win, `${item('browser')}.click()`);
    if (!(await waitInPage(win, `document.querySelector('${header} h2')?.textContent === 'Browser' && ${STATE} === 'open'`, 3_000))) return 'Browser did not switch the panel to its tabs';
    await js(win, `${item('sessions')}.click()`);
    if (!(await waitInPage(win, `document.querySelector('${header} h2')?.textContent === 'Sessions' && ${STATE} === 'open'`, 3_000))) return 'Sessions did not switch the panel back';
  } finally {
    if (!browserWas) deps.update({ browserEnabled: false });
    await home(win, deps);
  }
  return `ok: the header has Sessions, the project, View and the filter; the filter narrowed ${before} rows to none and Escape cleared it; Sessions closed and opened the panel; Projects put its list in the panel; Home stayed unselected; Browser switched the list and back`;
}

/** nav rail: headers. No sidebar toggle in any view's header, the title bar's Tools panel button works the side panel, no hide button on the rail of tools. */
export async function runNavRailHeadersStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  if (!(await waitInPage(win, "document.querySelector('[data-current-session] [data-tool-rail]')", 5_000))) return 'no session on screen';
  if (!(await js(win, "[...document.querySelectorAll('[data-sidebar-toggle]')].every((el) => el.closest('[data-title-bar]'))"))) return 'a view header still has a sidebar toggle';
  if (await js(win, "!!document.querySelector('[data-tool-rail] [data-rail-hide]')")) return 'the rail of tools still has its hide button';
  const button = "document.querySelector('[data-title-bar] [data-title-tools-panel]')";
  const side = "document.querySelector('[data-current-session] [data-panel-launcher-panel]')";
  if ((await js(win, `${button}.dataset.titleToolsPanel`)) === 'hide') await js(win, `${button}.click()`);
  if (!(await waitInPage(win, `${button}.dataset.titleToolsPanel === 'show' && ${button}.getAttribute('aria-pressed') === 'false'`, 3_000))) return `the Tools panel button does not say Show panel (${String(await js(win, `${button}?.dataset.titleToolsPanel`))})`;
  await js(win, `${button}.click()`);
  if (!(await waitInPage(win, `!!${side} && ${button}.dataset.titleToolsPanel === 'hide' && ${button}.getAttribute('aria-pressed') === 'true'`, 3_000))) return 'the Tools panel button did not show the side panel';
  await js(win, `${button}.click()`);
  if (!(await waitInPage(win, `!${side} && ${button}.dataset.titleToolsPanel === 'show'`, 3_000))) return 'the Tools panel button did not hide the side panel';
  // Where there is no panel (Home), it can't be pressed.
  await js(win, `${item('home')}.click()`);
  const none = await waitInPage(win, `${button}.disabled && ${button}.dataset.titleToolsPanel === 'none'`, 3_000);
  await home(win, deps);
  if (!none) return 'on Home the Tools panel button is not disabled';
  return 'ok: no sidebar toggle in a header, the title bar shows and hides the side panel (disabled on Home), no hide button on the rail';
}

/** nav rail: customize. Unchecking Activity takes it off, ⌥↑ moves Browser above Upcoming (saved), Reset puts it all back. */
export async function runNavRailCustomizeStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  const was = { navRailOrder: deps.prefs().navRailOrder, navRailHidden: deps.prefs().navRailHidden, browserEnabled: deps.prefs().browserEnabled };
  try {
    await home(win, deps);
    if (!was.browserEnabled) deps.update({ browserEnabled: true });
    deps.update({ navRailOrder: DEFAULT_ORDER, navRailHidden: [] });
    if (!(await waitInPage(win, `!!${item('browser')} && !!${item('activity')}`, 3_000))) return 'the rail did not start with Browser and Activity';

    // A right-click on the rail: the menu, with a check for each item.
    await js(win, `(() => { const r = document.querySelector('${RAIL} [data-nav-spacer]') ?? document.querySelector('${RAIL}'); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 })); })()`);
    const check = (id: string) => `document.querySelector('[role=menu] [data-nav-menu-item="${id}"]')`;
    if (!(await waitInPage(win, `${check('activity')}?.getAttribute('aria-checked') === 'true'`, 3_000))) return 'a right-click on the rail did not open its menu with Activity checked';
    await js(win, `${check('activity')}.click()`);
    if (!(await waitInPage(win, `!${item('activity')} && ${check('activity')}?.getAttribute('aria-checked') === 'false'`, 3_000))) return 'unchecking Activity did not take it off the rail, or closed the menu';
    if (!deps.prefs().navRailHidden.includes('activity')) return 'Activity hidden was not saved';
    press(win, 'Escape');
    await waitInPage(win, "!document.querySelector('[role=menu]')", 2_000);

    // ⌥↑ on Browser, twice: above Upcoming (Activity is hidden, so once would only pass it in the saved order).
    await js(win, `${item('browser')}.focus()`);
    win.focus();
    for (let i = 0; i < 2; i++) {
      press(win, 'Up', ['alt']);
      await settle(win);
    }
    const order = () => deps.prefs().navRailOrder;
    const above = () => order().indexOf('browser') < order().indexOf('upcoming');
    if (!(await waitInPage(win, `(() => { const ids = [...document.querySelectorAll('${RAIL} [data-nav-item]')].map((b) => b.dataset.navItem); return ids.indexOf('browser') < ids.indexOf('upcoming'); })()`, 3_000)) || !above()) return `⌥↑ did not move Browser above Upcoming (saved: ${order().join(', ')})`;
    if (!(await js(win, `document.activeElement === ${item('browser')}`))) return 'the focus left Browser after it moved';

    // Reset from the menu, opened from the title bar's More.
    await js(win, "document.querySelector('[data-title-bar] [data-title-more]').click()");
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-title-customize-rail]')", 2_000))) return "the title bar's More has no Customize the rail";
    await js(win, "document.querySelector('[role=menu] [data-title-customize-rail]').click()");
    if (!(await waitInPage(win, "document.querySelector('[role=menu] [data-nav-menu-reset]')", 2_000))) return 'Customize the rail did not open the menu';
    await js(win, "document.querySelector('[role=menu] [data-nav-menu-reset]').click()");
    const reset = await waitInPage(win, `!!${item('activity')}`, 3_000);
    const saved = deps.prefs();
    if (!reset || JSON.stringify(saved.navRailOrder) !== JSON.stringify(DEFAULT_ORDER) || saved.navRailHidden.length) return `Reset did not restore the default (${saved.navRailOrder.join(', ')}; hidden ${saved.navRailHidden.join(', ')})`;
    return 'ok: unchecking Activity took it off the rail, ⌥↑ moved Browser above Upcoming and saved it, Reset from More put the default back';
  } finally {
    press(win, 'Escape');
    deps.update(was);
    await home(win, deps);
  }
}

/** nav rail: peek. With the panel closed, resting on Sessions shows the peek; a row opens its session; Escape closes it. */
export async function runNavRailPeekStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  await home(win, deps);
  const peek = "document.querySelector('[data-nav-peek]')";
  const away = async () => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 300 });
    await waitInPage(win, `!${peek}`, 2_000);
  };
  try {
    if (!(await panelTo(win, 'closed'))) return 'the panel did not close';
    const at = (await js(win, `(() => { const r = ${item('sessions')}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number };
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    if (!(await waitInPage(win, `${peek}?.getAttribute('role') === 'dialog' && ${peek}.getAttribute('aria-label') === 'Sessions'`, 3_000))) return 'resting on Sessions did not show the peek';
    const rows = (await js(win, `${peek}.querySelectorAll('[data-peek-row]').length`)) as number;
    if (rows > 12) return `the peek lists ${rows} rows, more than 12`;
    await deps.shot('nav-rail-peek.png');

    // A row opens its session (one not running in Claude Code).
    const running = await deps.running();
    const target = ((await js(win, `[...${peek}.querySelectorAll('[data-peek-row]')].map((r) => r.dataset.peekRow)`)) as string[]).find((id) => !running.has(id) && !id.startsWith('run:'));
    let opened = 'no row to open';
    if (target) {
      await js(win, `${peek}.querySelector('[data-peek-row=${JSON.stringify(target)}]').click()`);
      if (!(await waitInPage(win, `!${peek} && document.querySelector('[data-current-session=${JSON.stringify(target)}], [data-remote-session]')`, 5_000))) return 'a row in the peek did not open its session and close the peek';
      opened = 'a row opened its session';
    }
    await away();

    // From the keys: → on Sessions opens it with the focus inside; Escape closes it and gives the focus back.
    await js(win, `${item('sessions')}.focus()`);
    win.focus();
    press(win, 'Right');
    if (!(await waitInPage(win, `${peek} && ${peek}.contains(document.activeElement)`, 3_000))) return '→ on Sessions did not open the peek with the focus in it';
    press(win, 'Escape');
    if (!(await waitInPage(win, `!${peek} && document.activeElement === ${item('sessions')}`, 3_000))) return 'Escape did not close the peek and give the focus back to Sessions';
    return `ok: resting on Sessions showed ${rows} rows, ${opened}, → opened it from the keys and Escape closed it`;
  } finally {
    await away();
    await panelTo(win, 'open');
    await home(win, deps);
  }
}

/** nav rail: minimal. In Minimal mode the Sessions badge is a dot, with no digits. */
export async function runNavRailMinimalStep(win: BrowserWindow, deps: NavRailSmoke): Promise<string> {
  const was = deps.prefs().minimalMode;
  const folder = deps.tempFolder();
  const waiting = `smoke-nav-minimal-${Date.now()}`;
  try {
    await home(win, deps);
    deps.update({ minimalMode: true });
    if (!(await waitInPage(win, "document.documentElement.getAttribute('data-minimal') === 'true'", 2_000))) return 'Minimal mode did not turn on';
    deps.host(waiting, folder.path, 'needs-you');
    const badge = `${item('sessions')}?.querySelector('[data-needs-you-pill]')`;
    if (!(await waitInPage(win, `!!${badge}?.hasAttribute('data-badge-dot')`, 8_000))) return `Sessions has no dot for what needs you (${String(await js(win, `${badge}?.outerHTML ?? 'no badge'`))})`;
    if (await js(win, `/\\d/.test(${badge}.textContent)`)) return 'the Sessions dot shows digits';
    await deps.shot('nav-rail-minimal.png');
    return 'ok: a dot with no digits on Sessions';
  } finally {
    deps.host(waiting, folder.path, 'closed');
    folder.remove();
    deps.update({ minimalMode: was });
    await settle(win);
  }
}
