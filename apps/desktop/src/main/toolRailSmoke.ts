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
 * it back. ⌥↑ on the first button of a group (Files) leaves it where it is (a button moves only inside its group).
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
  if (!before.startsWith('files changes terminal')) return `the rail does not start with Files, Changes and Terminal (${before})`;
  await press('files', 'ArrowUp');
  if ((await js(order)) !== before) return `⌥↑ on the group's first button moved it (${await js(order)})`;
  await press('terminal', 'ArrowUp');
  const moved = await waitInPage(win, `(${order}).startsWith('files terminal changes')`, 3_000);
  const focused = (await js(`document.activeElement?.dataset.railTool ?? null`)) as string | null;
  await press('terminal', 'ArrowDown');
  const back = await waitInPage(win, `(${order}) === ${JSON.stringify(before)}`, 3_000);
  if (!moved) return `⌥↑ on Terminal did not move it above Changes (${await js(order)})`;
  if (!back) return `⌥↓ did not put Terminal back (${await js(order)})`;
  if (focused !== 'terminal') return `the focus left Terminal after it moved (on ${focused})`;
  return `ok: ⌥↑ moved Terminal above Changes with the focus on it, ⌥↓ put it back (${before})`;
}

/**
 * Side panel launcher: with nothing on the side, the rail's panel button says Show panel and opens the side panel empty,
 * with a list of the tools to open there (the first one focused). ↓ and Enter open a tool from it, in front, in the
 * list's place; the button then says Hide panel and closes the side. Esc closes the empty panel.
 */
export async function runPanelLauncherStep(win: BrowserWindow, shot: (name: string) => Promise<void>, sessionId: string | null): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await showSession(win, sessionId);
  const button = q('[data-tool-rail] [data-rail-hide]');
  const launcher = q('[data-panel-launcher]');
  const panel = q('[data-panel-launcher-panel]');
  if (!(await waitInPage(win, `!!${button}`, 5_000))) return 'the rail has no panel button';
  // Start with nothing on the side.
  if ((await js(`${button}.dataset.railPanel`)) === 'hide') await js(`${button}.click()`);
  if (!(await waitInPage(win, `${button}.dataset.railPanel === 'show' && ${button}.getAttribute('aria-label') === 'Show panel'`, 3_000))) return 'the panel button does not say Show panel with nothing on the side';
  await js(`${button}.click()`);
  if (!(await waitInPage(win, `!!${launcher} && ${button}.dataset.railPanel === 'hide' && document.activeElement?.hasAttribute('data-panel-launcher-item')`, 3_000))) return 'Show panel did not open the empty side panel with its first row focused';
  const rows = (await js(`[...${launcher}.querySelectorAll('[data-panel-launcher-item]')].map((b) => b.dataset.panelLauncherItem + (b.textContent.match(/[⌘⌃⇧⌥]|Ctrl/) ? '+key' : ''))`)) as string[];
  const ids = rows.map((r) => r.replace('+key', ''));
  if (!ids.includes('terminal')) return `the list has no Terminal (${rows.join(', ')})`;
  if (ids.some((id) => id.startsWith('mod:') || id.startsWith('app:'))) return `the list has a mod's pane or an app (${rows.join(', ')})`;
  if (!rows.includes('terminal+key')) return `Terminal shows no shortcut (${rows.join(', ')})`;
  if (await js(`!!${panel}.querySelector('header, h2, button:not([data-panel-launcher-item]):not([data-panel-launcher-size] button)')`)) return 'the empty side panel still has a header or a close button';
  // Its left edge resizes it, as every panel's does: ← widens it by one step, → narrows it back.
  const resize = q('[data-panel-launcher-panel] [data-panel-resize]');
  if (!(await js(`!!${resize}`))) return 'the empty side panel has no edge to drag';
  const before = (await js(`${panel}.getBoundingClientRect().width`)) as number;
  await js(`${resize}.focus(); ${resize}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  if (!(await waitInPage(win, `${panel}.getBoundingClientRect().width > ${before} + 10`, 3_000))) return '← on the edge did not widen the empty side panel';
  await js(`${resize}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  if (!(await waitInPage(win, `Math.abs(${panel}.getBoundingClientRect().width - ${before}) <= 1`, 3_000))) return '→ on the edge did not narrow the empty side panel again';
  // Full takes the session area: the conversation hides, and Side brings it back.
  const size = (value: string) => `${panel}.querySelector('[data-panel-launcher-size] [data-panel-size="${value}"]')`;
  if (!(await js(`!!${size('full')}`))) return 'the empty side panel has no Side, Half and Full';
  await js(`${size('full')}.click()`);
  if (!(await waitInPage(win, `${panel}.hasAttribute('data-panel-full') && !${q('[data-composer-root]')}?.checkVisibility()`, 3_000))) return 'Full did not give the empty side panel the whole session area';
  await js(`${panel}.querySelector('[data-panel-launcher-size] [data-panel-size="side"]').click()`);
  if (!(await waitInPage(win, `!${panel}.hasAttribute('data-panel-full') && Math.abs(${panel}.getBoundingClientRect().width - ${before}) <= 1`, 3_000))) return 'Side did not put the empty side panel back beside the conversation';
  // The list is one block at a menu's width in the middle of the panel, both ways: at its own width, at half the
  // session area, and as the sheet of a narrow window.
  const centred = async (where: string): Promise<string | null> => {
    const box = (await js(`(() => { const p = ${panel}.getBoundingClientRect(); const l = ${launcher}.getBoundingClientRect(); return { dx: Math.abs((l.left + l.right) / 2 - (p.left + p.right) / 2), dy: Math.abs((l.top + l.bottom) / 2 - (p.top + p.bottom) / 2), w: l.width, pw: p.width }; })()`)) as { dx: number; dy: number; w: number; pw: number };
    if (box.w > 281 || box.dx > 2 || box.dy > 2) return `${where}, the list is not a block in the middle of the panel (${JSON.stringify(box)})`;
    return null;
  };
  const side = await centred('at its own width');
  if (side) return side;
  await shot('side-panel-launcher');
  const halfItem = `document.querySelector('[data-rail-menu-half]')`;
  const toggleHalf = async () => {
    await js(`(() => { const t = ${q('[data-tool-rail]')}; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 40 })); })()`);
    if (!(await waitInPage(win, `!!${halfItem}`, 3_000))) return false;
    await js(`${halfItem}.click()`);
    return true;
  };
  const widthBefore = (await js(`${panel}.getBoundingClientRect().width`)) as number;
  if (!(await toggleHalf())) return "the rail's menu has no Panels at half width";
  const halfOpen = await waitInPage(win, `!!${panel} && Math.abs(${panel}.getBoundingClientRect().width - ${widthBefore}) > 1`, 3_000);
  const half = halfOpen ? await centred('at half width') : null;
  if (halfOpen) await shot('side-panel-launcher-half');
  await toggleHalf();
  if (!halfOpen) return 'Panels at half width did not change the empty side panel';
  if (half) return half;
  if (!(await waitInPage(win, `!!${panel} && Math.abs(${panel}.getBoundingClientRect().width - ${widthBefore}) <= 1`, 3_000))) return 'the empty side panel did not go back to its own width';
  // The narrowest window: the empty panel is a sheet over the conversation.
  const bounds = win.getBounds();
  win.setContentSize(900, Math.max(win.getContentSize()[1] ?? 0, 560));
  const sheet = await waitInPage(win, `!!${q('[data-narrow-panel]')} && !!${panel} && Math.abs(${panel}.getBoundingClientRect().width - ${q('[data-narrow-panel]')}.getBoundingClientRect().width) <= 1`, 3_000);
  const narrow = sheet ? await centred('in the narrow sheet') : null;
  if (sheet) await shot('side-panel-launcher-narrow');
  win.setBounds(bounds);
  if (!(await waitInPage(win, `!${q('[data-narrow-panel]')} && !!${panel}`, 3_000))) return 'widening the window again did not bring the empty side panel back beside the conversation';
  if (!sheet) return 'in a narrow window the empty side panel is not a sheet over the conversation';
  if (narrow) return narrow;
  await js(`${launcher}.querySelector('[data-panel-launcher-item]').focus()`);
  // Esc closes the empty panel; then open it again for the pick.
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  if (!(await waitInPage(win, `!${panel} && ${button}.dataset.railPanel === 'show'`, 3_000))) return 'Esc did not close the empty side panel';
  await js(`${button}.click()`);
  if (!(await waitInPage(win, `document.activeElement?.dataset.panelLauncherItem === ${JSON.stringify(ids[0])}`, 3_000))) return 'the empty side panel did not open again';
  // A tool that opens on the side: Changes or Files where they apply, otherwise Ask, Agents or Commands.
  const pick = ['changes', 'files', 'ask', 'agents', 'commands', 'note'].find((id) => ids.includes(id));
  if (!pick) return `ok: the list shows ${rows.join(', ')}; skipped the pick, no tool there opens on the side`;
  const steps = ids.indexOf(pick);
  for (let i = 0; i < steps; i++) await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  if ((await js('document.activeElement?.dataset.panelLauncherItem')) !== pick) return `↓ did not move to ${pick} (on ${await js('document.activeElement?.dataset.panelLauncherItem')})`;
  // Enter on a focused button clicks it.
  await js('document.activeElement.click()');
  const rail = q(`[data-tool-rail] [data-rail-tool="${pick}"]`);
  if (!(await waitInPage(win, `!${panel} && ${rail}?.dataset.railState === 'front' && ${button}.dataset.railPanel === 'hide'`, 3_000))) return `${pick} from the list did not open in front in its place`;
  await js(`${button}.click()`);
  if (!(await waitInPage(win, `${rail}?.dataset.railState === 'closed' && !${panel} && ${button}.dataset.railPanel === 'show'`, 3_000))) return 'Hide panel did not close the side';
  return `ok: Show panel listed ${rows.join(', ')}; ← → on its edge resized it; Full and Side; Esc closed it; ↓ to ${pick} opened it in front; Hide panel closed the side`;
}
