import type { BrowserWindow } from 'electron';
import { waitInPage } from './pageDriver.ts';

// The smoke steps for the rail of tools at a session's right edge. They open and close panels in the session on screen
// and change nothing else.

const S = '[data-current-session]';
const q = (selector: string) => `document.querySelector(${JSON.stringify(`${S} ${selector}`)})`;
const CHANGES = q('[data-tool-rail] [data-toggle-changes]');

/** The steps before (the sidebar's) can end on Home: back to the smoke session, as no session is on screen. */
async function showSession(win: BrowserWindow, sessionId: string | null): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!sessionId || (await js(`!!document.querySelector(${JSON.stringify(S)})`))) return;
  await js(`document.querySelector('[data-session-id=${JSON.stringify(sessionId)}]')?.click()`);
  await waitInPage(win, `document.querySelector(${JSON.stringify(S)})?.dataset.currentSession === ${JSON.stringify(sessionId)}`, 5_000);
}

/** Closes Changes from the rail, whether it is in front or behind another panel. */
async function closeChanges(win: BrowserWindow): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 2 && (await js(`${CHANGES}?.dataset.railState`)) !== 'closed'; i++) await js(`${CHANGES}.click()`);
  return waitInPage(win, `${CHANGES}?.dataset.railState === 'closed' && !${q('[data-changes-panel]')}`, 2_000);
}

/**
 * Tool rail: the session has a vertical toolbar of tools at its right edge and no Panels buttons in its header. Changes
 * on the rail opens the Changes panel in front (`aria-pressed`), and a second click closes it.
 */
export async function runToolRailStep(win: BrowserWindow, shot: (name: string) => Promise<void>, sessionId: string | null): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await showSession(win, sessionId);
  const rail = q('[data-tool-rail]');
  if (!(await waitInPage(win, `!!${rail}`, 5_000))) return 'the session has no rail of tools';
  const shape = (await js(`({ role: ${rail}.getAttribute('role'), label: ${rail}.getAttribute('aria-label'), orientation: ${rail}.getAttribute('aria-orientation'), right: Math.round(${rail}.getBoundingClientRect().right), edge: Math.round(${q('')}.getBoundingClientRect().right), width: Math.round(${rail}.getBoundingClientRect().width) })`)) as Record<string, string | number>;
  if (shape.role !== 'toolbar' || shape.label !== 'Tools' || shape.orientation !== 'vertical') return `the rail is not a vertical toolbar named Tools (${JSON.stringify(shape)})`;
  if (shape.right !== shape.edge || shape.width !== 48) return `the rail is not 48px at the view's right edge (${JSON.stringify(shape)})`;
  if (await js(`!!${q('[data-session-header] [data-panel-toggles], [data-session-header] [data-toggle-terminal]')}`)) return 'the header still has the Panels buttons';
  if (!(await js(`!!${q('[data-tool-rail] [data-toggle-terminal]')}`))) return 'the rail has no Terminal';
  if (!(await js(`!!${CHANGES}`))) return 'ok: skipped Changes, the session is not on a git checkout (the rail is there, with Terminal)';
  if (!(await closeChanges(win))) return 'could not close Changes first';
  await js(`${CHANGES}.click()`);
  if (!(await waitInPage(win, `!!${q('[data-changes-panel]')} && ${CHANGES}.getAttribute('aria-pressed') === 'true' && ${CHANGES}.dataset.railState === 'front'`, 3_000))) return "the rail's Changes did not open the panel in front";
  await shot('tool-rail-changes');
  await js(`${CHANGES}.click()`);
  if (!(await waitInPage(win, `!${q('[data-changes-panel]')} && ${CHANGES}.getAttribute('aria-pressed') === 'false'`, 3_000))) return "a second click on the rail's Changes did not close it";
  const tools = (await js(`[...document.querySelectorAll(${JSON.stringify(`${S} [data-rail-tool]`)})].map((b) => b.dataset.railTool).join(', ')`)) as string;
  return `ok: a 48px toolbar at the right edge (${tools}), Changes opened in front and closed again`;
}

/** Tool rail badges: the badge on Changes says how many files changed, as the Changes panel lists them. */
export async function runToolRailBadgesStep(win: BrowserWindow, sessionId: string | null): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await showSession(win, sessionId);
  if (!(await waitInPage(win, `!!${q('[data-tool-rail]')}`, 5_000))) return 'the session has no rail of tools';
  if (!(await js(`!!${CHANGES}`))) return 'ok: skipped, the session is not on a git checkout';
  if (!(await closeChanges(win))) return 'could not close Changes first';
  await js(`${CHANGES}.click()`);
  const files = `${q('[data-changes-panel]')}?.querySelectorAll('[data-changed-file]').length ?? -1`;
  const uncommitted = `${q('[data-changes-base="uncommitted"]')}?.getAttribute('aria-checked') !== 'false'`;
  if (!(await waitInPage(win, `!!${q('[data-changes-panel]')} && !${q('[data-changes-panel]')}.innerText.includes('Loading') && ${uncommitted}`, 5_000))) return 'the Changes panel did not load';
  const count = (await js(files)) as number;
  const badge = (await js(`Number(${CHANGES}.querySelector('[data-rail-badge]')?.textContent ?? 0)`)) as number;
  const label = (await js(`${CHANGES}.getAttribute('aria-label')`)) as string;
  const tooltip = (await js(`${CHANGES}.dataset.tooltip`)) as string;
  await closeChanges(win);
  if (count !== badge && !(count > 99 && badge === 99)) return `the badge says ${badge}, the panel lists ${count} files`;
  if (count > 0 && !label.startsWith(`Changes, ${count} ${count === 1 ? 'file' : 'files'}`)) return `the label says "${label}"`;
  if (count > 0 && tooltip !== `Changes · ${count} ${count === 1 ? 'file' : 'files'}`) return `the tooltip says "${tooltip}"`;
  if (!(await js(`${CHANGES}.querySelector('[data-rail-badge]')?.getAttribute('aria-hidden') !== 'false'`))) return 'the badge is read out';
  return count ? `ok: the badge says ${badge}, as the panel's ${count} files, label "${label}"` : 'ok: no changed files, no badge';
}

/**
 * Tool rail apps: the rail's right-click menu lists the apps that open a folder (Finder at least) and GitHub, and checking one pins
 * it to the rail by its own icon as a plain button, not a toggle. It never clicks the app, which would open it, and
 * unpins it again.
 */
export async function runToolRailAppsStep(win: BrowserWindow, shot: (name: string) => Promise<void>, sessionId: string | null): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await showSession(win, sessionId);
  const rail = q('[data-tool-rail]');
  if (!(await waitInPage(win, `!!${rail}`, 5_000))) return 'the session has no rail of tools';
  const app = q('[data-tool-rail] [data-rail-tool="app:finder"]');
  const menuItem = `document.querySelector('[data-rail-menu-app="finder"]')`;
  const openMenu = async () => {
    await js(`(() => { const r = ${rail}.getBoundingClientRect(); ${rail}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 40 })); })()`);
    return waitInPage(win, `!!${menuItem}`, 3_000);
  };
  if (await js(`!!${app}`)) return 'Finder is on the rail before the step pinned it';
  if (!(await openMenu())) return "the rail's menu lists no Finder under Open in";
  if (!(await js(`!!document.querySelector('[data-rail-menu-app="github"]')`))) return "the rail's menu lists no GitHub under Open in";
  if ((await js(`${menuItem}.getAttribute('aria-checked')`)) !== 'false') return 'Finder shows as pinned before it was';
  await js(`${menuItem}.click()`);
  if (!(await waitInPage(win, `!!${app}`, 3_000))) return 'checking Finder in the menu did not pin it to the rail';
  // Main reads the icon from the app after the button shows. Linux has none to read: there the kind's own icon shows.
  if (process.platform !== 'linux') await waitInPage(win, `!!${app}.querySelector('img[data-app-icon="finder"]')?.complete`, 3_000);
  const button = (await js(`({ label: ${app}.getAttribute('aria-label'), pressed: ${app}.getAttribute('aria-pressed'), icon: !!${app}.querySelector('img[data-app-icon="finder"]'), last: [...document.querySelectorAll(${JSON.stringify(`${S} [data-rail-button]:not([data-rail-hide])`)})].at(-1) === ${app} })`)) as Record<string, unknown>;
  await shot('tool-rail-apps');
  // The pin is a preference: take it off again whatever the checks found.
  if (await openMenu()) await js(`${menuItem}.click()`);
  if (!(await waitInPage(win, `!${app}`, 3_000))) return 'unchecking Finder did not take it off the rail';
  if (!String(button.label).startsWith('Open in ')) return `the app's button is named "${button.label}"`;
  if (button.pressed !== null) return 'the app is a toggle button (aria-pressed)';
  if (!button.last) return "the app is not the rail's last button";
  if (process.platform !== 'linux' && !button.icon) return "the app shows no icon of its own";
  return `ok: Finder pinned last as "${button.label}"${button.icon ? ' with its own icon' : ''}, and unpinned`;
}

/**
 * Tool rail order: ⌥↑ on Terminal moves it above Changes, keeps the focus on it and the order after a render; ⌥↓ puts
 * it back. ⌥↑ on the first button of a group leaves it where it is (a button moves only inside its group).
 */
export async function runToolRailOrderStep(win: BrowserWindow, sessionId: string | null): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await showSession(win, sessionId);
  if (!(await waitInPage(win, `!!${q('[data-tool-rail]')}`, 5_000))) return 'the session has no rail of tools';
  if (!(await js(`!!${CHANGES}`))) return 'ok: skipped, the session is not on a git checkout (no Changes to move past)';
  const order = `[...document.querySelectorAll(${JSON.stringify(`${S} [data-rail-tool]`)})].map((b) => b.dataset.railTool).join(' ')`;
  const press = (tool: string, key: 'ArrowUp' | 'ArrowDown') =>
    js(`(() => { const b = ${q(`[data-tool-rail] [data-rail-tool="${tool}"]`)}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, altKey: true, bubbles: true })); })()`);
  const before = (await js(order)) as string;
  if (!before.startsWith('changes terminal')) return `the rail does not start with Changes and Terminal (${before})`;
  await press('changes', 'ArrowUp');
  if ((await js(order)) !== before) return `⌥↑ on the group's first button moved it (${await js(order)})`;
  await press('terminal', 'ArrowUp');
  const moved = await waitInPage(win, `(${order}).startsWith('terminal changes')`, 3_000);
  const focused = (await js(`document.activeElement?.dataset.railTool ?? null`)) as string | null;
  await press('terminal', 'ArrowDown');
  const back = await waitInPage(win, `(${order}) === ${JSON.stringify(before)}`, 3_000);
  if (!moved) return `⌥↑ on Terminal did not move it above Changes (${await js(order)})`;
  if (!back) return `⌥↓ did not put Terminal back (${await js(order)})`;
  if (focused !== 'terminal') return `the focus left Terminal after it moved (on ${focused})`;
  return `ok: ⌥↑ moved Terminal above Changes with the focus on it, ⌥↓ put it back (${before})`;
}
