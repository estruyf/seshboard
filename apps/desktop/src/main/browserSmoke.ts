import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { setFieldValue, until, waitInPage } from './pageDriver.ts';
import { MOD_KEY_PROPERTY, platformModifiers } from './smokeKeys.ts';

// The smoke steps for Enable browser (Settings › General). A tiny server on this computer (Node's own http module, on
// a free port) stands in for the web, so no outside site is needed: a page with a title, a link to a second one, and a
// link that leaves for example.com.

const PAGES: Record<string, string> = {
  // Broken icons around the real one: the tab still gets it, whichever the page reports first.
  '/': '<title>Smoke browser</title><link rel=icon href=/missing-a.png><link rel=icon href=/icon.svg><link rel=icon href=/missing-b.png><h1>One</h1><a id=next href=/two>Two</a> <a id=out href=https://example.com/>Out</a>',
  '/two': '<title>Smoke browser two</title><h1>Two</h1>',
  '/long': `<title>Smoke browser long ${'title '.repeat(40)}</title><h1>Long</h1>`,
};

/** The page's icon, for the tab's favicon: padded past what the window keeps as it is, so the tab shows it shrunk. */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><desc>${'padding '.repeat(4_000)}</desc><circle cx="8" cy="8" r="7" fill="#e8590c"/></svg>`;

export interface BrowserSmokeDeps {
  /** Saves a screenshot in light and in dark (`name-light.png`, `name-dark.png`), for the pull request. */
  shot(name: string): Promise<void>;
  /** Sets the browser on or off, as Settings would. */
  setBrowser(on: boolean): void;
  /** Sets the browser's other preferences: its card in the sidebar, previews. */
  setPrefs(patch: { browserIntro?: 'ask' | 'done'; webPreview?: boolean }): void;
  /** The outside addresses the preview sent to the browser (recorded, not opened, in a smoke run). */
  outside: readonly string[];
  /** Reloads the window, which the run then doesn't take for an engine restart. */
  reload(): void;
}

let server: Server | null = null;
let base = '';

/** The local site, started once for the steps that need it. */
async function site(): Promise<string> {
  if (server) return base;
  server = createServer((request, response) => {
    if (request.url === '/icon.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(ICON);
      return;
    }
    const body = PAGES[request.url ?? ''];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    response.end(body ?? 'Not found');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  // The run ends with the app; the server mustn't keep it alive.
  server.unref();
  return base;
}

/** The page of the Browser view's tab in front, or a session's (by the `data-web-preview-owner` the page carries). */
const pageWithTitle = (title: string): WebContents | undefined => webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.getTitle() === title);

const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

/**
 * "browser view": Browser in the sidebar's views shows the Browser view with its tabs listed, without the search row and
 * without an address bar until a tab is open; Open tab gives one; the local page loads there, and its title and favicon
 * show in the list. Dragging a tab moves it, and so does ⌥↓. A middle click closes the tab and ⌘⇧T brings it back.
 */
export async function runBrowserViewStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  for (const nav of ['home', 'upcoming', 'activity']) if (!(await js(`!!${q(`[data-nav="${nav}"]`)}`))) return `no ${nav} icon in the sidebar's views`;
  // "browser intro" may have opened it already; Browser again would go back to the sessions.
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'Browser did not show the Browser view and its tab list';
  if (!(await js(`!!${q('[data-browser-view] [data-browser-empty]')} || !!${q('[data-browser-view] [data-web-preview-slot]')}`))) return 'the Browser view shows neither a page nor its empty state';
  if (await js(`!!${q('[data-browser-view] [data-browser-empty]')} && !!${q('[data-browser-view] [data-browser-address]')}`)) return 'the empty Browser view shows an address bar';
  if (await js(`!!${q('[data-new-session]')}?.checkVisibility()`)) return 'the Browser tab list still shows New session and the search';
  // Under the tabs only Settings: no Done, no session count, no Projects.
  if (!(await js(`!!${q('[data-open-settings]')}?.checkVisibility()`))) return 'the Browser tab list has no Settings button';
  for (const hook of ['data-footer-sessions', 'data-archived-dock', 'data-open-projects']) if (await js(`!!${q(`[${hook}]`)}?.checkVisibility()`)) return `the Browser tab list still shows ${hook}`;
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view] [data-browser-address]')} && !${q('[data-browser-view] [data-browser-address]')}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', url.replace('http://', ''));
  await js(`${q('[data-browser-view] [data-browser-address]')}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load in the Browser view';
  const listed = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser'))`;
  if (!(await waitInPage(win, listed, 3_000))) return "the page's title is not in the tab list";
  // Copy address sits inside the bar, before the text (not clicked: the clipboard is the user's).
  const copy = q('[data-browser-view] [data-browser-copy-address]');
  if (!(await js(`!!${copy} && ${copy}.getBoundingClientRect().right <= ${q('[data-browser-view] [data-browser-address]')}.getBoundingClientRect().left + parseFloat(getComputedStyle(${q('[data-browser-view] [data-browser-address]')}).paddingLeft)`))) return 'no Copy address button in the address bar, or it covers the address';
  if (!(await waitInPage(win, `${listed}?.querySelector('img[src]')?.complete && ${listed}.querySelector('img').naturalWidth > 0`, 5_000))) return `the page's favicon is not on its tab (${String(await js(`${listed}?.innerHTML`)).slice(0, 300)})`;
  // A large icon (this one is over 30KB) is kept shrunk to a small PNG.
  if (!(await js(`${listed}.querySelector('img').src.startsWith('data:image/png') && ${listed}.querySelector('img').naturalWidth <= 40`))) return 'the large favicon was not shrunk to a small PNG';
  // A long title is cut in its row: no row, nor the ⋯ of any, goes past the list's edge.
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', `${url.replace('http://', '')}long`);
  await js(`${q('[data-browser-view] [data-browser-address]')}.form.requestSubmit()`);
  const longRow = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser long'))`;
  if (!(await waitInPage(win, longRow, 10_000))) return "the long page's title is not in the tab list";
  const overflow = `(() => { const list = ${q('[data-browser-tab-list]')}.getBoundingClientRect(); return [...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab], [data-browser-tab-list] [data-browser-tab-menu]')].some((el) => el.getBoundingClientRect().right > list.right + 1); })()`;
  if (await js(overflow)) return 'a long title pushes the tab rows past the edge of the list';
  // Dragged onto the top half of the short page's row, the long one goes before it; ⌥↓ on it puts it back after.
  // `listed` finds the first row with the short title, which is the long one once it moved first.
  const short = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser') && !t.textContent.includes('long'))`;
  const order = `(() => { const rows = [...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')]; return rows.indexOf(${longRow}) < rows.indexOf(${short}) ? 'long first' : 'short first'; })()`;
  await js(`(() => {
    const source = ${longRow}.closest('li');
    const target = ${short}.closest('li');
    const r = target.getBoundingClientRect();
    const data = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
    return new Promise((done) => requestAnimationFrame(() => {
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 20, clientY: r.top + 4 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 20, clientY: r.top + 4 }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }));
      done();
    }));
  })()`);
  if (!(await waitInPage(win, `${order} === 'long first'`, 3_000))) return 'dragging a tab onto another did not move it before that one';
  await js(`${longRow}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${order} === 'short first'`, 3_000))) return '⌥↓ on a tab did not move it down';
  // Closed again, so the steps after this find the short page's tab alone.
  await js(`${longRow}.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `!${longRow}`, 3_000))) return 'a middle click did not close the long tab';
  await deps.shot('browser-view');
  // A middle click closes it; ⌘⇧T in the Browser view brings it back.
  await js(`${listed}.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `!${listed}`, 3_000))) return 'a middle click did not close the tab';
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${listed} && ${q('[data-browser-view] [data-browser-address]')}`, 3_000))) return '⌘⇧T did not reopen the closed tab';
  if (await js(`!!${q('[data-activity]')}`)) return '⌘⇧T opened Activity in the Browser view';
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the reopened tab did not load its page';
  return `ok: ${url} opened in a Browser tab with Copy address in its bar, its title and favicon in the list, moved by a drag and ⌥↓, closed with a middle click and reopened with ⌘⇧T`;
}

/**
 * "browser suggestions": typing in the address bar lists the open tab (Switch to tab) and pages from the history; ↓ and
 * Enter open one. Needs "browser view" first: its tab on the local page, and its pages in the history.
 */
export async function runBrowserSuggestionsStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const address = '[data-browser-view] [data-browser-address]';
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-list] [data-browser-open-tab]'), 3_000))) return 'no Browser view (run "browser view" first)';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${q(address)} && !${q(address)}.value`, 3_000))) return 'Open tab gave no empty address bar';
  await setFieldValue(win, address, 'smoke');
  const rows = `[...document.querySelectorAll('[data-browser-suggestions] [data-browser-suggestion]')]`;
  if (!(await waitInPage(win, `${rows}.some((r) => r.dataset.browserSuggestion === 'tab' && r.textContent.includes('Switch to tab'))`, 3_000))) return `typing "smoke" did not offer the open tab (rows: ${String(await js(`${rows}.map((r) => r.textContent).join(' | ')`))})`;
  // The shot changes the theme, and the window may lose the focus, which closes the list: typing again opens it.
  await deps.shot('browser-suggestions');
  await setFieldValue(win, address, 'smoke browser long');
  const long = `${rows}.find((r) => r.dataset.browserSuggestion === 'history' && r.textContent.includes('/long'))`;
  if (!(await waitInPage(win, long, 3_000))) return `typing "smoke browser long" did not offer the page from the history (rows: ${String(await js(`${rows}.map((r) => r.textContent).join(' | ')`))})`;
  // A title match is not opened by Enter alone: ↓ picks it.
  if (await js(`${rows}.some((r) => r.getAttribute('aria-selected') === 'true')`)) return 'a suggestion was picked before ↓';
  await js(`${q(address)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${long}?.getAttribute('aria-selected') === 'true'`, 2_000))) return '↓ did not pick the suggestion';
  await js(`${q(address)}.form.requestSubmit()`);
  if (!(await waitInPage(win, `${q(address)}.value.endsWith('/long')`, 5_000))) return `Enter on the suggestion did not open its page (address: ${String(await js(`${q(address)}.value`))})`;
  if (await js(`!!${q('[data-browser-suggestions]')}`)) return 'the suggestions stayed open after Enter';
  // Closed again, so later steps find the short page's tab alone.
  const longRow = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser long'))`;
  if (await waitInPage(win, longRow, 3_000)) await js(`${longRow}.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  return 'ok: the open tab and a page from the history offered, ↓ and Enter opened it';
}

/**
 * "browser intro": with the browser off and previews off, there's no card and a session's ⌘⇧B shows no page. With the
 * browser on (the default), the sidebar's card tells about it once, and Open browser opens the Browser view.
 */
export async function runBrowserIntroStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  deps.setBrowser(false);
  deps.setPrefs({ browserIntro: 'ask', webPreview: false });
  if (!(await waitInPage(win, `!${q('[data-nav="browser"]')}`, 3_000))) return 'the Browser icon stayed with the browser off';
  if (await js(`!!${q('[data-browser-intro]')}`)) return 'the card about the browser shows with the browser off';
  const session = (await js(`document.querySelector('[data-current-session]')?.dataset.currentSession ?? null`)) as string | null;
  if (session) {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
    // Showing that nothing opens: a short wait is the only way.
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await js(`!!${q(`[data-current-session="${session}"] [data-web-preview]`)}`)) return 'with previews and the browser off, ⌘⇧B still opened a page';
  }
  deps.setPrefs({ webPreview: true });
  deps.setBrowser(true);
  if (!(await waitInPage(win, `${q('[data-browser-intro]')} && ${q('[data-nav="browser"]')}`, 3_000))) return 'no card about the browser in the sidebar with the browser on';
  await deps.shot('browser-intro');
  await js(`${q('[data-browser-intro-open]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-browser-intro]')} && ${q('[data-browser-view]')}`, 3_000))) return 'Open browser did not open the Browser view and put the card away';
  return `ok: ${session ? 'no page with the browser and previews off, ' : ''}the card told about the browser, Open browser opened the Browser view`;
}

/** "browser pin": pinned, the tab is still in the list with its pin after the window reloads. Needs "browser view" first. */
export async function runBrowserPinStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const listed = (pinned: boolean) => `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]${pinned ? '[data-browser-pinned]' : ''}')].some((t) => t.textContent.includes('Smoke browser'))`;
  // "browser control" in between goes to a session: back to the Browser view, where "browser view" left its tab.
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view] [data-web-preview-pin]')} && ${listed(false)}`, 3_000))) return 'no Smoke browser tab to pin (run "browser view" first)';
  await js(`${q('[data-browser-view] [data-web-preview-pin]')}.click()`);
  if (!(await waitInPage(win, listed(true), 3_000))) return 'Pin tab did not mark the tab pinned in the list';
  // A line under the pinned tabs, and no pin on the row.
  if (!(await js(`!!${q('[data-browser-tab-list] [data-browser-pinned-line]')} && !${q('[data-browser-tab-list] [data-browser-pinned] svg.lucide-pin')}`))) return 'no line under the pinned tabs, or a pin icon still on the row';
  // Renamed from its menu: the name shows in place of the page's title, and comes back with the pin.
  const named = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab][data-browser-pinned]')].some((t) => t.textContent.includes('Smoke browser renamed'))`;
  const tabId = (await js(`[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab][data-browser-pinned]')].find((t) => t.textContent.includes('Smoke browser')).dataset.browserTab`)) as string;
  await js(`${q(`[data-browser-tab-menu="${tabId}"]`)}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-rename]'), 2_000))) return 'the tab menu has no Rename tab';
  await js(`${q('[data-browser-tab-rename]')}.click()`);
  if (!(await waitInPage(win, q('[data-rename-tab-input]'), 2_000))) return 'Rename tab did not open its dialog';
  await setFieldValue(win, '[data-rename-tab-input]', 'Smoke browser renamed');
  await js(`${q('[data-rename-tab-save]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-rename-tab-dialog]')} && ${named}`, 2_000))) return 'the tab does not show the name it was given';
  // The engine saves a new pin at once; give the call a moment to land before the window goes.
  await new Promise((resolve) => setTimeout(resolve, 500));
  deps.reload();
  if (!(await waitInPage(win, `${q('[data-nav="browser"]')} && ${q('[data-browser-tab-list]')}`, 15_000))) return 'after the reload the sidebar does not list the Browser tabs again';
  if (!(await waitInPage(win, listed(true), 5_000))) return `after the reload the pinned tab is gone (${String(await js(`[...document.querySelectorAll('[data-browser-tab]')].map((t) => t.textContent).join(', ')`))})`;
  if (!(await js(named))) return 'after the reload the pinned tab lost its name';
  // Its icon comes back with it, before its page loads.
  const pinnedIcon = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab][data-browser-pinned]')].find((t) => t.textContent.includes('Smoke browser'))?.querySelector('img')`;
  if (!(await waitInPage(win, `${pinnedIcon}?.naturalWidth > 0`, 3_000))) return 'after the reload the pinned tab has no icon until its page loads';
  // Shown again, its page loads only now.
  await js(`[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser')).click()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the restored tab did not load its page when shown';
  // A pinned tab takes two middle clicks to close: the first asks, the second closes. ⌘⇧T brings it back pinned.
  const pinnedRow = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab][data-browser-pinned]')].find((t) => t.textContent.includes('Smoke browser') || t.hasAttribute('data-browser-confirm-close'))`;
  const middle = `${pinnedRow}.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`;
  await js(middle);
  if (!(await waitInPage(win, `${pinnedRow}?.hasAttribute('data-browser-confirm-close')`, 3_000))) return 'a middle click on a pinned tab closed it or asked nothing';
  await js(middle);
  if (!(await waitInPage(win, `!${pinnedRow}`, 3_000))) return 'a second middle click did not close the pinned tab';
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${listed(true)} && ${q('[data-browser-view] [data-web-preview-pin]')}`, 3_000))) return '⌘⇧T did not bring the pinned tab back';
  // Leave nothing pinned for later runs on the same profile.
  await js(`${q('[data-browser-view] [data-web-preview-pin]')}.click()`);
  if (!(await waitInPage(win, `!(${listed(true)})`, 3_000))) return 'Unpin tab left the pin';
  return 'ok: pinned, renamed, kept with its name and icon across a reload, loaded when shown, closed only on a second middle click, reopened, unpinned';
}

/**
 * "session browser": a link in a reply opens in the session's browser panel, and the session's row gets the globe. Uses
 * the demo session "Fix the cart button typo", whose reply links to example.com (the page may not load: only the panel
 * and its address are checked).
 */
export async function runSessionBrowserStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const link = 'https://example.com/guidelines/buttons';
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="home"]'), 3_000))) return 'no Home icon';
  await js(`${q('[data-nav="home"]')}.click()`);
  const row = `[...document.querySelectorAll('[data-session-list] [data-session-id]')].find((r) => r.textContent.includes('Fix the cart button typo'))`;
  if (!(await waitInPage(win, row, 5_000))) return 'the demo session "Fix the cart button typo" is not in the sidebar';
  const id = (await js(`${row}.dataset.sessionId`)) as string;
  await js(`${row}.click()`);
  const anchor = `${q(`[data-current-session="${id}"] [data-transcript] a[href="${link}"]`)}`;
  if (!(await waitInPage(win, anchor, 8_000))) return 'the reply has no link to click';
  await js(`${anchor}.click()`);
  const address = `${q(`[data-current-session="${id}"] [data-web-preview] [data-browser-address]`)}`;
  if (!(await waitInPage(win, `${address} && ${address}.value.includes('example.com/guidelines/buttons')`, 5_000))) return `the panel does not show the link (address: ${String(await js(`${address}?.value ?? 'no panel'`))})`;
  if (!(await js(`!!${q(`[data-session-list] [data-session-id="${id}"] [data-session-open="browser"]`)}`))) return 'the session row has no browser mark';
  await deps.shot('session-browser');

  // One tab already has its strip, with × and +. + opens a second tab; the local page loads there.
  const P = `[data-current-session="${id}"] [data-web-preview]`;
  const strip = `document.querySelectorAll(${JSON.stringify(`${P} [data-web-preview-tabs] [data-browser-tab]`)}).length`;
  if (!(await js(`${strip} === 1 && !!${q(`${P} [data-browser-new-tab]`)}`))) return 'one tab shows no tab strip with + (no way to open another)';
  await js(`${q(`${P} [data-browser-new-tab]`)}.click()`);
  if (!(await waitInPage(win, `${strip} === 2`, 3_000))) return '+ did not open a second tab';
  const url = await site();
  await setFieldValue(win, `${P} [data-browser-address]`, url.replace('http://', ''));
  await js(`${q(`${P} [data-browser-address]`)}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load in the second tab';

  // ⌘⇧B hides the panel and shows it again as it was: both tabs, the local page in front, the same page still running.
  const loaded = webContents.getAllWebContents().filter((c) => c.getType() === 'webview' && !c.isDestroyed() && c.getTitle() === 'Smoke browser');
  const toggle = `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`;
  await js(toggle);
  if (!(await waitInPage(win, `!${q(P)} && !!${q(`[data-session-list] [data-session-id="${id}"] [data-session-open="browser"]`)}`, 3_000))) return '⌘⇧B did not hide the panel, or hiding it closed its tabs';
  await js(toggle);
  if (!(await waitInPage(win, `${strip} === 2 && ${q(`${P} [data-browser-address]`)}.value.includes(${JSON.stringify(url.replace('http://', '').replace(/\/$/, ''))})`, 3_000))) return `shown again, the panel lost its tabs (${String(await js(`${strip} + ' tabs, ' + (${q(`${P} [data-browser-address]`)}?.value ?? 'no panel')`))})`;
  if (loaded.some((c) => c.isDestroyed())) return 'shown again, the page loaded anew instead of staying';

  // Widened as far as it goes, the panel still leaves the conversation its 440px.
  for (let i = 0; i < 40; i++) await js(`${q(`${P} [role=separator]`)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`);
  const room = `(() => { const view = ${q(`[data-current-session="${id}"]`)}.getBoundingClientRect(); const panel = ${q(P)}.getBoundingClientRect(); return Math.round(panel.left - view.left); })()`;
  if (!(await waitInPage(win, `${room} >= 439`, 2_000))) return `widened, the panel leaves the conversation ${String(await js(room))}px`;
  for (let i = 0; i < 40; i++) await js(`${q(`${P} [role=separator]`)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`);

  // Full: the page takes the session area and nothing covers it (the point in its middle is the page).
  await js(`${q(`${P} [data-web-preview-size="full"]`)}.click()`);
  const wide = `(() => { const page = [...document.querySelectorAll('[data-web-preview-page]')].find((p) => p.style.left !== '-100000px'); if (!page) return false; const r = page.getBoundingClientRect(); return r.width > window.innerWidth * 0.6 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === page; })()`;
  if (!(await waitInPage(win, `${q(`${P}[data-web-preview-full]`)} && ${wide}`, 3_000))) return 'in Full the page is not on screen across the session area';
  if (await js(`${q(`[data-current-session="${id}"] [data-transcript]`)}?.checkVisibility()`)) return 'in Full the conversation still shows';
  await js(`${q(`${P} [data-web-preview-conversation]`)}.click()`);
  if (!(await waitInPage(win, `!${q(`${P}[data-web-preview-full]`)} && ${q(`[data-current-session="${id}"] [data-transcript]`)}.checkVisibility()`, 3_000))) return '‹ Conversation did not go back to the side';

  // Closing the panel closes its tabs (none is pinned): the row's globe goes.
  await js(`${q(`${P} [data-web-preview-close]`)}.click()`);
  if (!(await waitInPage(win, `!${q(P)} && !${q(`[data-session-list] [data-session-id="${id}"] [data-session-open="browser"]`)}`, 3_000))) return 'closing the panel left it or the row\'s globe';
  return 'ok: the reply link opened in the session panel with the globe on the row, + opened a second tab, ⌘⇧B hid and showed it as it was, widened it left the conversation 440px, Full showed the page, closing the panel closed its tabs';
}

/**
 * "browser favorites": the star adds the local page to the favourites, listed in the sidebar with its icon and kept
 * after a reload. The sidebar's favourite shows its page, an empty tab offers it as a tile, and ⌘D in the address bar
 * removes it again.
 */
export async function runBrowserFavoritesStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'Browser did not show the Browser view';
  const V = '[data-browser-view]';
  const address = q(`${V} [data-browser-address]`);
  const open = async (where: string) => {
    await setFieldValue(win, `${V} [data-browser-address]`, url.replace('http://', ''));
    await js(`${address}.form.requestSubmit()`);
    return (await waitInPage(win, `${address}?.value && ${JSON.stringify(url)}.includes(${address}.value.replace(/\\/$/, ''))`, 5_000)) ? null : `the local page did not load ${where}`;
  };
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${address} && !${address}.disabled`, 3_000))) return 'Open tab gave no address bar';
  const failed = await open('in a new tab');
  if (failed) return failed;
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load';

  // The star: pressed, and the page in the sidebar's favourites with its icon.
  await js(`${q(`${V} [data-web-preview-favorite]`)}.click()`);
  const listed = q(`[data-browser-favorites-list] [data-browser-favorite="${url}"]`);
  if (!(await waitInPage(win, `${q(`${V} [data-web-preview-favorite]`)}.getAttribute('aria-pressed') === 'true' && ${listed}`, 3_000))) return 'the star did not add the page to the favourites in the sidebar';
  if (!(await waitInPage(win, `${listed}.querySelector('img')?.naturalWidth > 0`, 5_000))) return "the favourite has no icon";
  await deps.shot('browser-favorites');

  // Kept by the engine: still there after the window reloads.
  await new Promise((resolve) => setTimeout(resolve, 300));
  deps.reload();
  if (!(await waitInPage(win, `${q('[data-browser-tab-list]')} && ${listed}`, 15_000))) return 'after the reload the favourite is gone';

  // The sidebar's favourite shows its page.
  await js(`${listed}.click()`);
  if (!(await waitInPage(win, `${address}?.value && ${JSON.stringify(url)}.includes(${address}.value.replace(/\\/$/, ''))`, 5_000))) return "the sidebar's favourite did not show its page";

  // Browsing on keeps the favourite's address. Use current page's address takes the page's; Edit favourite… sets it back.
  await setFieldValue(win, `${V} [data-browser-address]`, `${url.replace('http://', '')}two`);
  await js(`${address}.form.requestSubmit()`);
  if (!(await waitInPage(win, `${address}.value.endsWith('/two')`, 5_000))) return 'the second page did not load';
  if (!(await js(`!!${listed}`))) return 'browsing on changed the favourite\'s address';
  const menuOf = (row: string) => js(`(() => { const r = ${row}.getBoundingClientRect(); ${row}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 })); })()`);
  await menuOf(listed);
  if (!(await waitInPage(win, q('[data-browser-favorite-use-page]'), 2_000))) return "the favourite's menu has no Use current page's address";
  await js(`${q('[data-browser-favorite-use-page]')}.click()`);
  const moved = q(`[data-browser-favorites-list] [data-browser-favorite="${url}two"]`);
  if (!(await waitInPage(win, `${moved} && !${listed}`, 3_000))) return "Use current page's address did not change the favourite";
  await menuOf(moved);
  if (!(await waitInPage(win, q('[data-browser-favorite-edit]'), 2_000))) return "the favourite's menu has no Edit favourite…";
  await js(`${q('[data-browser-favorite-edit]')}.click()`);
  if (!(await waitInPage(win, q('[data-edit-favorite-dialog] [data-edit-favorite-address]'), 2_000))) return 'Edit favourite… did not open its dialog';
  await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-address]', 'not an address');
  await js(`${q('[data-edit-favorite-save]')}.click()`);
  if (!(await waitInPage(win, q('[data-edit-favorite-problem]'), 2_000))) return 'Edit favourite… saved an address that is none';
  await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-address]', url);
  await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-title]', 'Smoke favourite');
  await js(`${q('[data-edit-favorite-save]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-edit-favorite-dialog]')} && ${listed}?.textContent.includes('Smoke favourite')`, 3_000))) return 'Edit favourite… did not save the address and name';

  // An empty tab offers it as a tile, which loads it there.
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  const tile = q(`${V} [data-web-preview-empty] [data-browser-favorite="${url}"]`);
  if (!(await waitInPage(win, tile, 3_000))) return 'an empty tab does not offer the favourite';
  await js(`${tile}.click()`);
  if (!(await waitInPage(win, `!${tile} && ${JSON.stringify(url)}.includes(${address}.value.replace(/\\/$/, ''))`, 5_000))) return "the empty tab's favourite did not load there";

  // ⌘D in the address bar takes it off the favourites.
  await js(`${address}.focus(); ${address}.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `!${q('[data-browser-favorites-list]')} && ${q(`${V} [data-web-preview-favorite]`)}.getAttribute('aria-pressed') === 'false'`, 3_000))) return '⌘D did not remove the favourite';
  return "ok: starred with its icon in the sidebar, kept after a reload, opened from the sidebar and an empty tab, kept its address while browsing, changed by Use current page's address and Edit favourite…, removed with ⌘D";
}

function escape(win: BrowserWindow): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
}

/** Runs a command from the palette by its title (⌘K, the title typed, Enter); false if it isn't offered. */
async function paletteCommand(win: BrowserWindow, title: string): Promise<boolean> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  await js('document.activeElement?.blur?.()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: platformModifiers(['meta']) });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: platformModifiers(['meta']) });
  if (!(await waitInPage(win, "document.activeElement?.matches('[data-palette-input]')", 3_000))) return false;
  await setFieldValue(win, '[data-palette-input]', title);
  const option = `[...document.querySelectorAll('[data-command-palette] [role=option]')].find((el) => el.innerText.split('\\n')[0].trim() === ${JSON.stringify(title)})`;
  if (!(await waitInPage(win, option, 3_000))) {
    escape(win);
    return false;
  }
  await js(`${option}.click()`);
  return true;
}

/**
 * "browser palette": the page's commands from the palette, on a local page in the Browser view: zoom in and back to
 * actual size, the developer tools open and closed, Rename tab… and Go to tab… offered, and Clear data for this
 * site… asks, then signs the page out (its cookie is gone). Clear all browsing data… asks too (cancelled).
 */
export async function runBrowserPaletteStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'Browser did not show the Browser view';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  const address = q('[data-browser-view] [data-browser-address]');
  if (!(await waitInPage(win, `${address} && !${address}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', `${url.replace('http://', '')}two`);
  await js(`${address}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke browser two') !== undefined, 10_000))) return 'the local page did not load';
  let page = pageWithTitle('Smoke browser two')!;

  if (!(await paletteCommand(win, 'Zoom in on the page'))) return 'no Zoom in on the page in the palette';
  if (!(await until(() => page.getZoomLevel() > 0, 3_000))) return `Zoom in left the page at level ${page.getZoomLevel()}`;
  if (!(await waitInPage(win, `${q('[data-browser-view] [data-web-preview-zoom]')}?.dataset.webPreviewZoom === '110%'`, 2_000))) return 'zoomed in, the toolbar does not say 110%';
  if (!(await paletteCommand(win, 'Page at actual size'))) return 'no Page at actual size in the palette';
  if (!(await until(() => page.getZoomLevel() === 0, 3_000))) return 'Page at actual size did not reset the zoom';

  // Mute and unmute from the palette.
  if (!(await paletteCommand(win, 'Mute tab'))) return 'no Mute tab in the palette';
  if (!(await until(() => page.isAudioMuted(), 3_000))) return 'Mute tab did not mute the page';
  if (!(await paletteCommand(win, 'Unmute tab'))) return 'no Unmute tab in the palette';
  if (!(await until(() => !page.isAudioMuted(), 3_000))) return 'Unmute tab did not unmute the page';

  // A sized window.open (a sign-in) opens a real window that keeps window.opener; it closes again.
  const before = new Set(BrowserWindow.getAllWindows().map((w) => w.id));
  await page.executeJavaScript("window.__popup = window.open('/two', 'signin', 'width=400,height=400'); !!window.__popup", true);
  let popup: BrowserWindow | undefined;
  if (!(await until(() => (popup = BrowserWindow.getAllWindows().find((w) => !before.has(w.id) && !w.isDestroyed())) !== undefined, 5_000))) return 'a sized window.open opened no window';
  const opener = await popup!.webContents.executeJavaScript('!!window.opener').catch(() => false);
  popup!.destroy();
  if (opener !== true) return 'the sign-in window lost window.opener';

  // A page whose process stops loads again by itself.
  const stopped = page;
  stopped.forcefullyCrashRenderer();
  const answers = async (contents: WebContents) => (await Promise.race([contents.executeJavaScript('document.title').catch(() => ''), new Promise((resolve) => setTimeout(() => resolve(''), 500))])) === 'Smoke browser two';
  let back = false;
  for (const started = Date.now(); !back && Date.now() - started < 8_000; await new Promise((resolve) => setTimeout(resolve, 200))) {
    const live = webContents.getAllWebContents().filter((c) => c.getType() === 'webview' && !c.isDestroyed() && !c.isCrashed() && c.getTitle() === 'Smoke browser two');
    for (const contents of live) if (await answers(contents)) {
      page = contents;
      back = true;
      break;
    }
  }
  if (!back) return 'a stopped page did not load again by itself';
  if (await js(`!!${q('[data-browser-view] [data-web-preview-crashed]')}`)) return 'a stopped page still shows its notice after loading again';

  if (!(await paletteCommand(win, 'Page developer tools'))) return 'no Page developer tools in the palette';
  if (!(await until(() => page.isDevToolsOpened(), 5_000))) return 'Page developer tools did not open them';
  page.closeDevTools();

  if (!(await paletteCommand(win, 'Rename tab…'))) return 'no Rename tab… in the palette';
  if (!(await waitInPage(win, q('[data-rename-tab-dialog]'), 3_000))) return 'Rename tab… did not open its dialog';
  escape(win);
  if (!(await waitInPage(win, `!${q('[data-rename-tab-dialog]')}`, 3_000))) return 'Escape did not close Rename tab';

  if (!(await paletteCommand(win, 'Go to tab…'))) return 'no Go to tab… in the palette';
  if (!(await waitInPage(win, "[...document.querySelectorAll('[data-command-palette] [role=option]')].some((el) => el.innerText.includes('Smoke browser two'))", 3_000))) return 'Go to tab… does not list the tab';
  escape(win);
  await waitInPage(win, "!document.querySelector('[data-command-palette]')", 2_000);

  // Signed in (a cookie), then signed out of this site.
  await page.executeJavaScript("document.cookie = 'smoke-session=1; path=/'");
  if (!(await page.executeJavaScript('document.cookie')).includes('smoke-session')) return 'the page could not set its cookie';
  if (!(await paletteCommand(win, 'Clear data for this site…'))) return 'no Clear data for this site… in the palette';
  if (!(await waitInPage(win, q('[data-clear-site-data-dialog] [data-confirm]'), 3_000))) return 'Clear data for this site… did not ask first';
  await js(`${q('[data-clear-site-data-dialog] [data-confirm]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-clear-site-data-dialog]')}`, 5_000))) return 'the dialog stayed after clearing';
  let signedOut = false;
  for (const started = Date.now(); !signedOut && Date.now() - started < 5_000; await new Promise((resolve) => setTimeout(resolve, 100))) {
    signedOut = !page.isDestroyed() && !String(await page.executeJavaScript('document.cookie').catch(() => 'smoke-session')).includes('smoke-session');
  }
  if (!signedOut) return "the site's cookie is still there after Clear data for this site";

  if (!(await paletteCommand(win, 'Clear all browsing data…'))) return 'no Clear all browsing data… in the palette';
  if (!(await waitInPage(win, q('[data-clear-browsing-data-dialog]'), 3_000))) return 'Clear all browsing data… did not ask first';
  await deps.shot('browser-clear-data');
  escape(win);
  if (!(await waitInPage(win, `!${q('[data-clear-browsing-data-dialog]')}`, 3_000))) return 'Escape did not close Clear all browsing data';
  return 'ok: zoom in (110% in the toolbar) and actual size, mute and unmute, a sign-in window with its opener, a stopped page loaded again, developer tools, Rename tab… and Go to tab… from the palette; Clear data for this site asked and removed the cookie; Clear all asked';
}

/**
 * "browser outside link": with the browser off, the panel is the web preview as before: a local page loads, and
 * its link to example.com goes to the browser (recorded) while the page stays.
 */
export async function runBrowserOutsideLinkStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(false);
  if (!(await waitInPage(win, `!${q('[data-nav="browser"]')}`, 3_000))) return 'the Browser icon stayed with the browser off';
  // The steps before end in the Browser view, which goes with the browser: back to the first session.
  if (!(await js("!!document.querySelector('[data-current-session]')"))) {
    await js("document.querySelector('[data-go-home]')?.click()");
    await waitInPage(win, "!!document.querySelector('[data-session-list] [data-session-id]')", 3_000);
    await js("document.querySelector('[data-session-list] [data-session-id]')?.click()");
    await waitInPage(win, "!!document.querySelector('[data-current-session]')", 5_000);
  }
  const session = (await js(`document.querySelector('[data-current-session]')?.dataset.currentSession ?? null`)) as string | null;
  if (!session) return 'no session on screen';
  const S = `[data-current-session="${session}"]`;
  if (!(await js(`!!${q(`${S} [data-web-preview]`)}`))) {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', shiftKey: true, ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
    if (!(await waitInPage(win, q(`${S} [data-web-preview]`), 3_000))) return 'the web preview did not open';
  }
  await setFieldValue(win, `${S} [data-web-preview-address]`, url.replace('http://', ''));
  await js(`${q(`${S} [data-web-preview-address]`)}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load in the web preview';
  const page = pageWithTitle('Smoke browser')!;
  const before = deps.outside.length;
  await page.executeJavaScript("document.getElementById('out').click()", true);
  if (!(await until(() => deps.outside.slice(before).includes('https://example.com/'), 3_000))) return `the outside link was not sent to the browser (sent: ${JSON.stringify(deps.outside.slice(before))})`;
  if (page.getTitle() !== 'Smoke browser') return `the page left for ${page.getURL()}`;
  if (await js(`!!${q(`${S} [data-web-preview-tabs]`)} || !!${q(`${S} [data-web-preview-pin]`)}`)) return 'the web preview shows tabs or a pin with the browser off';
  await js(`${q(`${S} [data-web-preview-close]`)}.click()`);
  return 'ok: with the browser off, the outside link went to the browser and the page stayed';
}
