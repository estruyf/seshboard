import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { BrowserWindow, session, webContents, type WebContents } from 'electron';
import { setFieldValue, until, waitInPage } from './pageDriver.ts';
import type { BrowserToolRequest, BrowserToolResult } from '@seshboard/protocol/bridge';
import { MOD_KEY_PROPERTY, platformModifiers } from './smokeKeys.ts';
import { isSessionPage, runPageMenuEntry } from './webPreview.ts';

// The smoke steps for Enable browser (Settings › General). A tiny server on this computer (Node's own http module, on
// a free port) stands in for the web, so no outside site is needed: a page with a title, a link to a second one, and a
// link that leaves for example.com.

/** The file "browser download" saves: long enough that its Downloading toast is cut. */
const DOWNLOAD_NAME = `smoke-download-with-a-name-long-enough-to-be-cut-${'long-'.repeat(6)}.txt`;
const DOWNLOAD_TEXT = 'Saved by the smoke run.';
/** The download's response, held open until the step has checked its Downloading toast. */
let heldDownload: ServerResponse | null = null;
/** The responses of `/slow`, which never answers until "browser stop" ends them: a page that is still loading. */
const heldSlow: ServerResponse[] = [];

const PAGES: Record<string, string> = {
  // Broken icons around the real one: the tab still gets it, whichever the page reports first.
  '/': '<title>Smoke browser</title><link rel=icon href=/missing-a.png><link rel=icon href=/icon.svg><link rel=icon href=/missing-b.png><h1>One</h1><a id=next href=/two>Two</a> <a id=out href=https://example.com/>Out</a>',
  '/two': '<title>Smoke browser two</title><h1>Two</h1>',
  '/long': `<title>Smoke browser long ${'title '.repeat(40)}</title><h1>Long</h1>`,
  // A click that reaches the button marks the body: a pick must keep it from the page.
  '/profile': '<title>Smoke profile</title><h1>Profile</h1>',
  '/from-link': '<title>Smoke from a link</title><h1>From a link</h1>',
  '/download': `<title>Smoke download</title><a id=file href=/file/${DOWNLOAD_NAME}>File</a>`,
  '/pick': '<title>Smoke pick</title><main><h1 id=heading>Pick me</h1><p id=words>Some words to quote here.</p><button class="cta" data-testid=buy onclick="document.body.dataset.clicked=1">Buy now</button></main>',
};

/** Responses Chromium shows itself, as text: a REST API's JSON and an Atom feed (what SharePoint's REST API sends). */
const RAW: Record<string, { type: string; body: string }> = {
  '/data.json': { type: 'application/json; charset=utf-8', body: '{"value":[{"Id":2,"FileRef":"/sites/Front Matter/Home"}]}' },
  '/feed.xml': { type: 'application/atom+xml;type=feed;charset=utf-8', body: '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>2</id></entry></feed>' },
};

/** The page's icon, for the tab's favicon: padded past what the window keeps as it is, so the tab shows it shrunk. */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><desc>${'padding '.repeat(4_000)}</desc><circle cx="8" cy="8" r="7" fill="#e8590c"/></svg>`;

export interface BrowserSmokeDeps {
  /** Saves a screenshot in light and in dark (`name-light.png`, `name-dark.png`), for the pull request. */
  shot(name: string): Promise<void>;
  /** Sets the browser on or off, as Settings would. */
  setBrowser(on: boolean): void;
  /** Sets the browser's other preferences: its card in the sidebar, previews, control by agents. */
  setPrefs(patch: { browserIntro?: 'ask' | 'done'; webPreview?: boolean; browserControl?: boolean; colorScheme?: 'system' | 'light' | 'dark' }): void;
  /** The browser tools' calls, as the engine's bridge makes them (main's `browserAgent`). */
  agent?(request: BrowserToolRequest): Promise<BrowserToolResult>;
  /** The outside addresses the preview sent to the browser (recorded, not opened, in a smoke run). */
  outside: readonly string[];
  /** Reloads the window, which the run then doesn't take for an engine restart. */
  reload(): void;
  /** Where pages' downloads go in a smoke run (a folder in the throwaway profile). */
  downloadsDir: string;
  /** Opens a `seshboard://` link as macOS hands one over (main's `openDeepLink`). */
  openLink?(url: string): void;
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
    if (request.url === `/file/${DOWNLOAD_NAME}`) {
      // The first half now, the rest when the step says (`heldDownload`). Without nosniff, Chromium waits for more bytes
      // to guess the type before it starts the download.
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename="${DOWNLOAD_NAME}"`, 'content-length': String(DOWNLOAD_TEXT.length) });
      response.write(DOWNLOAD_TEXT.slice(0, 8));
      heldDownload = response;
      return;
    }
    if (request.url === '/slow') {
      heldSlow.push(response);
      return;
    }
    const raw = RAW[request.url ?? ''];
    if (raw) {
      response.writeHead(200, { 'content-type': raw.type });
      response.end(raw.body);
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
 * show in the list. Dragging a tab moves it, and so does ⌥↓. A middle click closes the tab and ⌘⇧T brings it back. Under
 * the tabs, Browser profiles, which opens Settings › Browser at the profiles.
 */
export async function runBrowserViewStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  for (const nav of ['home', 'upcoming', 'activity']) if (!(await js(`!!${q(`[data-nav="${nav}"]`)}`))) return `no ${nav} icon in the sidebar's views`;
  // "browser intro" may have opened it already.
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'Browser did not show the Browser view and its tab list';
  // A second click on the nav rail's Browser closes the panel and keeps the Browser view; a third opens it on the tabs.
  await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-sidebar]')}?.dataset.sidebarState === 'closed' && ${q('[data-browser-view]')}`, 3_000))) return 'a second click on Browser did not close the panel and keep the Browser view';
  await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-sidebar]')}?.dataset.sidebarState === 'open' && ${q('[data-browser-tab-list]')}`, 3_000))) return 'a third click on Browser did not open the panel on its tabs';
  if (!(await js(`!!${q('[data-browser-view] [data-browser-empty]')} || !!${q('[data-browser-view] [data-web-preview-slot]')}`))) return 'the Browser view shows neither a page nor its empty state';
  if (await js(`!!${q('[data-browser-view] [data-browser-empty]')} && !!${q('[data-browser-view] [data-browser-address]')}`)) return 'the empty Browser view shows an address bar';
  if (await js(`!!${q('[data-sidebar-open] [data-filter-toggle]')}?.checkVisibility()`)) return 'the Browser tab list still shows the session filter';
  // Under the tabs only Browser profiles (Projects and Settings are on the nav rail): no Done, no session count.
  for (const hook of ['data-open-browser-profiles']) if (!(await js(`!!${q(`[${hook}]`)}?.checkVisibility()`))) return `the Browser tab list has no ${hook} button`;
  for (const hook of ['data-footer-sessions', 'data-archived-dock']) if (await js(`!!${q(`[${hook}]`)}?.checkVisibility()`)) return `the Browser tab list still shows ${hook}`;
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
  // Copying the whole bar gives the address with its scheme (a copy event of its own, so the user's clipboard stays).
  const copied = await js(`(() => {
    const field = ${q('[data-browser-view] [data-browser-address]')};
    field.setSelectionRange(0, field.value.length);
    const data = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return { shown: field.value, copied: data.getData('text/plain') };
  })()`) as { shown: string; copied: string };
  if (!copied.copied.startsWith('http://') || !copied.copied.includes(copied.shown)) return `copying the address bar gave "${copied.copied}" for "${copied.shown}", not the full address`;
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
  // Browser profiles under the tabs opens Settings › Browser at its profiles; Settings again goes back to the tabs.
  await js(`${q('[data-open-browser-profiles]')}.click()`);
  if (!(await waitInPage(win, `document.activeElement?.matches('[data-settings-page="browser"] [data-new-browser-profile]')`, 3_000))) return 'Browser profiles did not open Settings › Browser at its profiles';
  await js(`${q('[data-open-settings]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'closing Settings did not go back to the Browser view and its tabs';
  return `ok: ${url} opened in a Browser tab with Copy address in its bar, its title and favicon in the list, moved by a drag and ⌥↓, closed with a middle click and reopened with ⌘⇧T, and Browser profiles opened Settings at the profiles`;
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

/**
 * "browser pin" (pins and favourites in the Browser view): Pin tab keeps the tab pinned across a reload, and Unpin tab
 * takes it off; Bookmark tab… shows the bookmark and keeps the tab; Add to favourites moves the Smoke browser tab to a tile, with a dot
 * while open; Edit favourite… names the tile; after a reload the tile is still there with its name and icon, and opens its
 * page. Browsing on in its tab keeps the favourite's address, until Use current page's address takes the tab's; Edit
 * favourite… refuses what is no address and sets it back. A middle click closes its tab; Remove from favourites takes it
 * away. Needs "browser view" first.
 */
export async function runBrowserPinStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  const listed = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser'))`;
  const tile = q(`[data-browser-favorites-bar] [data-browser-favorite="${url}"]`);
  const menuOn = (target: string) => js(`(() => { const t = ${target}; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.bottom })); })()`);
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}?.click()`);
  if (!(await waitInPage(win, listed, 3_000))) return 'no Smoke browser tab in the list (run "browser view" first)';
  // The toolbar works on the tab in front: bring the Smoke browser tab there, whatever earlier steps left open.
  await js(`${listed}.click()`);
  if (!(await waitInPage(win, `${listed}.getAttribute('aria-current') === 'page'`, 3_000))) return 'a click on the Smoke browser tab did not bring it to the front';
  // Pinned from the toolbar: first in the list above a line, and still a pinned tab (not a tile) after a reload.
  const pin = q('[data-browser-view] [data-web-preview-pin]');
  const pinnedRow = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab][data-browser-pinned]')].find((t) => t.textContent.includes('Smoke browser'))`;
  if (!(await waitInPage(win, `${pin} && !${pin}.disabled`, 3_000))) return 'the Browser view offers no Pin tab';
  await js(`${pin}.click()`);
  if (!(await waitInPage(win, `${pinnedRow} && ${q('[data-browser-tab-list] [data-browser-pinned-line]')}`, 3_000))) return 'Pin tab did not pin the tab in the list';
  // The engine saves a new pin at once; give the call a moment to land before the window goes.
  await new Promise((resolve) => setTimeout(resolve, 500));
  deps.reload();
  if (!(await waitInPage(win, `${q('[data-browser-tab-list]')} && ${pinnedRow}`, 15_000))) return 'after the reload the pinned tab is gone, or turned into a favourite';
  await js(`${pinnedRow}.click()`);
  if (!(await waitInPage(win, `${pin}?.getAttribute('aria-pressed') === 'true'`, 3_000))) return 'the restored pinned tab does not show its pin pressed';
  await js(`${pin}.click()`);
  if (!(await waitInPage(win, `!${pinnedRow} && ${listed}`, 3_000))) return 'Unpin tab left the pin';
  const tabId = (await js(`${listed}.dataset.browserTab`)) as string;
  // Bookmark tab… shows the bookmark to name and file, and the tab stays in the list. Removed again for what follows.
  await js(`${q(`[data-browser-tab-menu="${tabId}"]`)}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-bookmark]'), 2_000))) return 'the tab menu has no Bookmark tab…';
  await js(`${q('[data-browser-tab-bookmark]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-bookmark-dialog] [data-bookmark-name]')} && ${listed}`, 3_000))) return 'Bookmark tab… did not show the bookmark, or the tab left the list';
  await js(`${q('[data-bookmark-remove]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-bookmark-dialog]')}`, 2_000))) return 'Remove did not close the bookmark';
  await js(`${q(`[data-browser-tab-menu="${tabId}"]`)}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-favorite]'), 2_000))) return 'the tab menu has no Add to favourites';
  await js(`${q('[data-browser-tab-favorite]')}.click()`);
  if (!(await waitInPage(win, `${tile}?.hasAttribute('data-browser-favorite-open') && !${listed}`, 3_000))) return 'Add to favourites did not move the tab to an open tile';
  await deps.shot('browser-favorite-tiles');
  // Named from the tile's menu (Edit favourite…): the name is the tile's label.
  const edit = async (target: string, fields: { title?: string; address?: string }) => {
    await menuOn(target);
    if (!(await waitInPage(win, q('[data-browser-favorite-edit]'), 2_000))) return "the tile's menu has no Edit favourite…";
    await js(`${q('[data-browser-favorite-edit]')}.click()`);
    if (!(await waitInPage(win, q('[data-edit-favorite-dialog] [data-edit-favorite-title]'), 2_000))) return 'Edit favourite… did not open its dialog';
    if (fields.title !== undefined) await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-title]', fields.title);
    if (fields.address !== undefined) await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-address]', fields.address);
    await js(`${q('[data-edit-favorite-save]')}.click()`);
    return null;
  };
  const named = await edit(tile, { title: 'Smoke tile' });
  if (named) return named;
  if (!(await waitInPage(win, `!${q('[data-edit-favorite-dialog]')} && ${tile}?.getAttribute('aria-label')?.startsWith('Smoke tile')`, 2_000))) return 'the tile does not carry the name it was given';
  // The engine saves it at once; give the call a moment to land before the window goes.
  await new Promise((resolve) => setTimeout(resolve, 500));
  deps.reload();
  if (!(await waitInPage(win, `${q('[data-browser-tab-list]')} && ${tile}`, 15_000))) return 'after the reload the favourite is gone';
  if (!(await js(`${tile}.getAttribute('aria-label').startsWith('Smoke tile') && !${tile}.hasAttribute('data-browser-favorite-open')`))) return 'after the reload the tile lost its name, or shows a tab still open';
  if (!(await waitInPage(win, `${tile}.querySelector('img')?.naturalWidth > 0`, 3_000))) return 'after the reload the tile has no icon';
  await js(`${tile}.click()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the tile did not load its page';
  if (!(await waitInPage(win, `${tile}.hasAttribute('data-browser-favorite-open') && ${tile}.getAttribute('aria-current') === 'page'`, 3_000))) return 'the tile does not show its tab open and in front';
  // Browsing on in its tab keeps the favourite's address; Use current page's address takes the tab's.
  const address = q('[data-browser-view] [data-browser-address]');
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', `${url.replace('http://', '')}two`);
  await js(`${address}.form.requestSubmit()`);
  if (!(await waitInPage(win, `${address}.value.endsWith('/two')`, 5_000))) return "the tile's tab did not load the second page";
  if (!(await js(`!!${tile}`))) return "browsing on changed the favourite's address";
  await menuOn(tile);
  if (!(await waitInPage(win, q('[data-browser-favorite-use-page]'), 2_000))) return "the tile's menu has no Use current page's address";
  await js(`${q('[data-browser-favorite-use-page]')}.click()`);
  const moved = q(`[data-browser-favorites-bar] [data-browser-favorite="${url}two"]`);
  if (!(await waitInPage(win, `${moved} && !${tile}`, 3_000))) return "Use current page's address did not change the favourite";
  // Edit favourite… refuses what is no address, then sets it back.
  const refused = await edit(moved, { address: 'not an address' });
  if (refused) return refused;
  if (!(await waitInPage(win, q('[data-edit-favorite-problem]'), 2_000))) return 'Edit favourite… saved an address that is none';
  await setFieldValue(win, '[data-edit-favorite-dialog] [data-edit-favorite-address]', url);
  await js(`${q('[data-edit-favorite-save]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-edit-favorite-dialog]')} && ${tile}?.getAttribute('aria-label')?.startsWith('Smoke tile')`, 3_000))) return 'Edit favourite… did not save the address';
  // A middle click closes its tab; the tile stays.
  await js(`${tile}.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${tile} && !${tile}.hasAttribute('data-browser-favorite-open')`, 3_000))) return "a middle click did not close the tile's tab";
  // Leave no favourite for later runs on the same profile.
  await menuOn(tile);
  if (!(await waitInPage(win, q('[data-browser-favorite-remove]'), 2_000))) return "the tile's menu has no Remove from favourites";
  await js(`${q('[data-browser-favorite-remove]')}.click()`);
  if (!(await waitInPage(win, `!${tile}`, 3_000))) return 'Remove from favourites left the tile';
  return "ok: pinned across a reload and unpinned, Add to favourites moved the tab to an open tile, named, kept with its name and icon across a reload, opened its page, kept its address while browsing, changed by Use current page's address and Edit favourite…, closed on a middle click, removed";
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
  // A right click on a tab in the strip shows its menu.
  const stripTab = q(`${P} [data-web-preview-tabs] [data-browser-tab]`);
  await js(`(() => { const t = ${stripTab}; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.bottom })); })()`);
  if (!(await waitInPage(win, `${q('[role="menu"] [data-browser-tab-bookmark]')} && ${q('[role="menu"] [data-browser-tab-pin]')}`, 2_000))) return 'a right click on a tab in the strip showed no tab menu';
  escape(win);
  if (!(await waitInPage(win, `!${q('[role="menu"] [data-browser-tab-bookmark]')}`, 2_000))) return 'Esc did not close the tab menu';
  // A session's tab can be pinned from the toolbar: pressed, marked in the strip, then unpinned again.
  const pin = q(`${P} [data-web-preview-pin]`);
  if (!(await waitInPage(win, `${pin} && !${pin}.disabled`, 3_000))) return 'no Pin tab in the session\'s browser panel';
  await js(`${pin}.click()`);
  if (!(await waitInPage(win, `${pin}.getAttribute('aria-pressed') === 'true' && !!${q(`${P} [data-web-preview-tabs] [data-browser-pinned]`)}`, 3_000))) return 'Pin tab did not pin the tab';
  await js(`${pin}.click()`);
  if (!(await waitInPage(win, `${pin}.getAttribute('aria-pressed') === 'false' && !${q(`${P} [data-web-preview-tabs] [data-browser-pinned]`)}`, 3_000))) return 'Unpin tab did not unpin the tab';

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
 * "browser window": Open in new window in a session's Browser panel moves both its tabs to a window of their own (the
 * page in front loads there), the panel leaves the session and its Browser button says where the tabs are, and the
 * agent's tools find the page in that window. Move back puts the tabs back in the panel, in front; the window's close
 * button puts them back without opening it. Closes the panel at the end.
 */
export async function runBrowserWindowStep(win: BrowserWindow, deps: BrowserSmokeDeps & { browserWindowOf(sessionId: string): BrowserWindow | undefined; shotOf(win: BrowserWindow, name: string): Promise<void> }): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="home"]'), 3_000))) return 'no Home icon';
  await js(`${q('[data-nav="home"]')}.click()`);
  const row = `[...document.querySelectorAll('[data-session-list] [data-session-id]')].find((r) => r.textContent.includes('Fix the cart button typo'))`;
  if (!(await waitInPage(win, row, 5_000))) return 'the demo session "Fix the cart button typo" is not in the sidebar';
  const id = (await js(`${row}.dataset.sessionId`)) as string;
  await js(`${row}.click()`);
  const S = `[data-current-session="${id}"]`;
  const P = `${S} [data-web-preview]`;
  const rail = q(`${S} [data-tool-rail] [data-toggle-web]`);
  if (!(await waitInPage(win, rail, 5_000))) return 'the session has no Browser button on its rail';
  if (!(await js(`!!${q(P)}`))) await js(`${rail}.click()`);
  if (!(await waitInPage(win, q(`${P} [data-browser-address]`), 3_000))) return 'the Browser button did not open the panel';
  const url = await site();
  const go = async (path: string) => {
    await setFieldValue(win, `${P} [data-browser-address]`, `${url.replace('http://', '')}${path}`);
    await js(`${q(`${P} [data-browser-address]`)}.form.requestSubmit()`);
  };
  await go('');
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load in the panel';
  const strip = (root: string) => `document.querySelectorAll(${JSON.stringify(`${root} [data-web-preview-tabs] [data-browser-tab]`)}).length`;
  await js(`${q(`${P} [data-browser-new-tab]`)}.click()`);
  if (!(await waitInPage(win, `${strip(P)} === 2`, 3_000))) return '+ did not open a second tab';
  await go('two');
  if (!(await until(() => pageWithTitle('Smoke browser two') !== undefined, 10_000))) return 'the second page did not load in the panel';

  const popOut = q(`${P} [data-browser-pop-out]`);
  if (!(await js(`!!${popOut}`))) return 'the panel has no Open in new window button';
  await js(`${popOut}.click()`);
  let browser: BrowserWindow | undefined;
  try {
    if (!(await until(() => deps.browserWindowOf(id) !== undefined, 5_000))) return 'the browser window did not open';
    browser = deps.browserWindowOf(id)!;
    const W = `[data-browser-window="${id}"]`;
    const inWindow = (expression: string, timeoutMs = 5_000) => waitInPage(browser!, expression, timeoutMs);
    if (!(await inWindow(`${strip(W)} === 2 && ${q(`${W} [data-browser-address]`)}?.value.includes('/two')`, 20_000))) return 'the browser window does not show both tabs with the second in front';
    const here = () => webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.getTitle() === 'Smoke browser two' && c.hostWebContents === browser!.webContents);
    if (!(await until(() => here() !== undefined, 10_000))) return 'the page in front did not load in the browser window';
    if (!(await waitInPage(win, `!${q(P)} && !!${q(`${S} [data-tool-rail] [data-toggle-web][data-browser-away]`)}`, 3_000))) return 'the panel is still in the session, or its Browser button does not say the browser is in its own window';
    if (!(await js(`!!${q(`[data-session-list] [data-session-id="${id}"] [data-session-open="browser"]`)}`))) return 'the session row lost its browser mark';
    // The agent's tools find the page in the browser window.
    if (deps.agent) {
      const where = await deps.agent({ sessionId: id, tool: 'where', args: {} });
      if (where.url !== `${url}two`) return `the agent's tools did not find the page in the browser window (${where.url ?? where.text})`;
    }
    // Quote in message, on the page in the browser window, lands in the session's message box in the main window.
    const page = here()!;
    const text = 'Two';
    runPageMenuEntry(browser.webContents, page, { x: 0, y: 0, linkURL: '', srcURL: '', selectionText: text }, 'quote');
    const box = q(`${S} [data-composer]`);
    if (!(await waitInPage(win, `${box}?.value.includes(${JSON.stringify(`> ${text}`)})`, 3_000))) return `Quote in message in the browser window did not reach the session's message (box: ${JSON.stringify(await js(`${box}?.value ?? null`))})`;
    await setFieldValue(win, `${S} [data-composer]`, '');
    // The Browser button and ⌘⇧B leave the tabs where they are.
    await js(`${rail}.click()`);
    if (await waitInPage(win, q(P), 500)) return 'the Browser button opened the panel in the session while the browser has its own window';
    await deps.shot('browser-window');
    await deps.shotOf(browser, 'browser-window-own.png');

    // Move back: the tabs return to the panel, which opens on the one in front.
    await browser.webContents.executeJavaScript(`${q(`${W} [data-browser-move-back]`)}.click()`);
    if (!(await until(() => deps.browserWindowOf(id) === undefined, 5_000))) return 'Move back did not close the browser window';
    if (!(await waitInPage(win, `${strip(P)} === 2 && ${q(`${P} [data-browser-address]`)}?.value.includes('/two')`, 8_000))) return `Move back did not put both tabs back in the panel (${String(await js(`${strip(P)} + ' tabs, ' + (${q(`${P} [data-browser-address]`)}?.value ?? 'no panel')`))})`;
    if (await js(`!!${q(`${S} [data-browser-away]`)}`)) return 'the Browser button still says the browser is in its own window';

    // Again, and closed with its button: the tabs come back without the panel opening.
    await js(`${popOut}.click()`);
    if (!(await until(() => deps.browserWindowOf(id) !== undefined, 5_000))) return 'the browser window did not open the second time';
    browser = deps.browserWindowOf(id)!;
    if (!(await waitInPage(browser, `${strip(W)} === 2`, 20_000))) return 'the second browser window does not show both tabs';
    await browser.webContents.executeJavaScript(`${q(`${W} [data-close-window]`)}.click()`);
    if (!(await until(() => deps.browserWindowOf(id) === undefined, 5_000))) return 'the browser window did not close with its button';
    if (!(await waitInPage(win, `!${q(P)} && !!${q(`[data-session-list] [data-session-id="${id}"] [data-session-open="browser"]`)}`, 3_000))) return 'closed, the browser window opened the panel or lost the tabs';
    await js(`${rail}.click()`);
    if (!(await waitInPage(win, `${strip(P)} === 2`, 3_000))) return 'after the browser window closed, the panel did not show both tabs';
    await js(`${q(`${P} [data-web-preview-close]`)}.click()`);
    if (!(await waitInPage(win, `!${q(P)}`, 3_000))) return 'the panel did not close';
    return 'ok: both tabs moved to a window of their own and loaded there, the panel left the session with its Browser button marked, the agent found the page there, Quote in message reached the session message box, Move back put them back in front and the close button put them back closed';
  } finally {
    const open = deps.browserWindowOf(id);
    if (open && !open.isDestroyed()) open.close();
  }
}

/**
 * "browser pick": a session's page is marked as one (its menu sends to the message). Pick an element outlines what the
 * pointer is over, Esc stops it, and a click puts the element in the message as a chip with its picture, without the
 * page getting the click. Quote in message and Add element to message (the page's right-click menu, run as its
 * entries, as a native menu can't be clicked) quote the selection under its page and add the element at the point.
 * Leaves the message box empty and closes the panel.
 */
export async function runBrowserPickStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="home"]'), 3_000))) return 'no Home icon';
  await js(`${q('[data-nav="home"]')}.click()`);
  const row = `[...document.querySelectorAll('[data-session-list] [data-session-id]')].find((r) => r.textContent.includes('Fix the cart button typo'))`;
  if (!(await waitInPage(win, row, 5_000))) return 'the demo session "Fix the cart button typo" is not in the sidebar';
  const id = (await js(`${row}.dataset.sessionId`)) as string;
  await js(`${row}.click()`);
  const S = `[data-current-session="${id}"]`;
  if (!(await waitInPage(win, q(`${S} [data-composer]`), 5_000))) return 'the session shows no message box';
  if (!(await paletteCommand(win, 'New tab'))) return 'the palette offers no New tab in the session';
  const P = `${S} [data-web-preview]`;
  if (!(await waitInPage(win, q(`${P} [data-browser-address]`), 3_000))) return "New tab opened no browser panel in the session";
  const url = `${await site()}pick`;
  await setFieldValue(win, `${P} [data-browser-address]`, url.replace('http://', ''));
  await js(`${q(`${P} [data-browser-address]`)}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke pick') !== undefined, 10_000))) return 'the local page did not load in the session\'s tab';
  const page = pageWithTitle('Smoke pick')!;
  if (!(await until(() => isSessionPage(page.id), 5_000))) return "the session's page is not marked as one: its menu would not offer Quote in message";

  // Dragged as narrow as it goes, the toolbar keeps room to type an address: Pin, the star, Open in browser and the
  // browser profile move to ⋯, the sizes become one button that names the size, and Pick an element stays.
  for (let i = 0; i < 40; i++) await js(`${q(`${P} [role=separator]`)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`);
  const addressWidth = `Math.round(${q(`${P} [data-browser-address]`)}.getBoundingClientRect().width)`;
  const sizeMenu = q(`${P} [data-web-preview-size-menu]`);
  // Every button keeps its size, and the last one (×) ends inside the toolbar.
  const toolbarFits = `(() => { const bar = ${q(`${P} [data-web-preview-toolbar]`)}; const r = bar.getBoundingClientRect(); return [...bar.querySelectorAll('button')].filter((b) => b.checkVisibility()).every((b) => { const box = b.getBoundingClientRect(); return box.right <= r.right + 0.5 && box.width >= 20; }); })()`;
  // The buttons that don't fit, by their label, width and where they end, so a failure says which one.
  const misfits = `(() => { const bar = ${q(`${P} [data-web-preview-toolbar]`)}; const r = bar.getBoundingClientRect(); return [...bar.querySelectorAll('button')].filter((b) => b.checkVisibility()).filter((b) => { const box = b.getBoundingClientRect(); return !(box.right <= r.right + 0.5 && box.width >= 20); }).map((b) => (b.getAttribute('aria-label') || b.textContent.trim()) + ' ' + Math.round(b.getBoundingClientRect().width) + 'px wide, ' + Math.round(b.getBoundingClientRect().right - r.right) + 'px past the edge').join('; ') + ' in a ' + Math.round(r.width) + 'px toolbar'; })()`;
  if (!(await waitInPage(win, `${addressWidth} >= 80 && ${toolbarFits} && !${q(`${P} [data-web-preview-pin]`)}.checkVisibility() && ${sizeMenu}?.checkVisibility() && ${sizeMenu}.textContent.includes('Side')`, 3_000))) return `in a narrow panel the address bar is ${String(await js(addressWidth))}px wide, a button is squeezed or past the edge (${(await js(toolbarFits)) ? 'no' : String(await js(misfits))}), Pin still takes the toolbar, or the size button doesn't show Side`;
  await js(`${q(`${P} [data-web-preview-more]`)}.click()`);
  if (!(await waitInPage(win, `${q('[role="menu"] [data-page-pin]')} && ${q('[role="menu"] [data-page-profile]')}`, 2_000))) return 'in a narrow panel ⋯ has no Pin tab or Browser profile';
  escape(win);
  if (!(await waitInPage(win, `!${q('[role="menu"] [data-page-pin]')}`, 2_000))) return 'Esc did not close ⋯';
  await js(`${sizeMenu}.click()`);
  if (!(await waitInPage(win, `${q('[role="menu"] [data-web-preview-size="half"]')} && ${q('[role="menu"] [data-web-preview-size="full"]')}`, 2_000))) return 'the size button opened no menu with Half and Full';
  escape(win);
  if (!(await waitInPage(win, `!${q('[role="menu"] [data-web-preview-size="half"]')}`, 2_000))) return 'Esc did not close the size menu';

  // Pick an element: pressed, with its hint; Esc in the app stops it.
  const pick = q(`${P} [data-web-preview-pick]`);
  const picking = `${q(`${P} [data-web-preview-picking]`)} && ${pick}.getAttribute('aria-pressed') === 'true'`;
  if (!(await waitInPage(win, `${pick} && !${pick}.disabled`, 3_000))) return 'no Pick an element in the toolbar';
  await js(`${pick}.click()`);
  if (!(await waitInPage(win, picking, 3_000))) return 'Pick an element did not start a pick (no hint, not pressed)';
  escape(win);
  if (!(await waitInPage(win, `!${q(`${P} [data-web-preview-picking]`)}`, 3_000))) return 'Esc did not stop the pick';

  // A click on the button picks it: a chip and its picture in the message box, and the page never got the click.
  await js(`${pick}.click()`);
  if (!(await waitInPage(win, picking, 3_000))) return 'Pick an element did not start a second pick';
  const center = (await page.executeJavaScript(`(() => { const r = document.querySelector('[data-testid=buy]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`)) as { x: number; y: number };
  page.sendInputEvent({ type: 'mouseMove', x: center.x, y: center.y });
  await deps.shot('browser-pick');
  page.sendInputEvent({ type: 'mouseDown', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  page.sendInputEvent({ type: 'mouseUp', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  const chips = `[...document.querySelectorAll(${JSON.stringify(`${S} [data-context-tray] [data-context-chip="element"]`)})]`;
  const images = `document.querySelectorAll(${JSON.stringify(`${S} [data-attachments] img`)}).length`;
  if (!(await waitInPage(win, `${chips}.some((c) => c.textContent.includes('data-testid="buy"')) && ${images} === 1`, 5_000))) return `the picked button is not in the message (chips: ${String(await js(`${chips}.map((c) => c.textContent).join(', ') || 'none'`))}, images: ${String(await js(images))})`;
  if (!(await waitInPage(win, `!${q(`${P} [data-web-preview-picking]`)}`, 2_000))) return 'the pick went on after the click';
  if (await page.executeJavaScript('document.body.dataset.clicked === "1"')) return 'the page got the click that picked the button';

  // The page's menu: Quote in message quotes the selection under its page; Add element to message adds the heading.
  const host = page.hostWebContents;
  if (!host) return 'the page has no window';
  const text = 'Some words to quote here.';
  runPageMenuEntry(host, page, { x: 0, y: 0, linkURL: '', srcURL: '', selectionText: text }, 'quote');
  const box = q(`${S} [data-composer]`);
  if (!(await waitInPage(win, `${box}.value.includes(${JSON.stringify(`From ${url}:\n> ${text}`)})`, 3_000))) return `Quote in message did not quote the selection under its page (box: ${JSON.stringify(await js(`${box}.value`))})`;
  const heading = (await page.executeJavaScript(`(() => { const r = document.getElementById('heading').getBoundingClientRect(); return { x: Math.round(r.x + 4), y: Math.round(r.y + r.height / 2) }; })()`)) as { x: number; y: number };
  runPageMenuEntry(host, page, { x: heading.x, y: heading.y, linkURL: '', srcURL: '', selectionText: '' }, 'add-element');
  if (!(await waitInPage(win, `${chips}.some((c) => c.textContent.includes('#heading')) && ${images} === 2`, 5_000))) return 'Add element to message did not add the heading with its picture';

  // Leave the message box as it was, and close the panel.
  await setFieldValue(win, `${S} [data-composer]`, '');
  await js(`for (const b of document.querySelectorAll(${JSON.stringify(`${S} [data-context-tray] [data-context-chip="element"] [data-context-chip-remove]`)})) b.click()`);
  await js(`for (const b of [...document.querySelectorAll(${JSON.stringify(`${S} [data-attachments] button`)})].reverse()) b.click()`);
  if (!(await waitInPage(win, `${chips}.length === 0 && ${images} === 0`, 3_000))) return 'the chips or pictures stayed in the message box';
  await js(`${q(`${P} [data-web-preview-close]`)}.click()`);
  return 'ok: a narrow panel kept room for the address, with Pin in ⋯ and the sizes behind one button, the page was marked as a session page, a pick stopped on Esc, a click put the button in the message with its picture (the page never got it), Quote in message quoted the selection under its page, and Add element to message added the heading';
}

/**
 * "browser favorites" (bookmarks now): the star bookmarks the local page and shows its bookmark; kept after a reload,
 * listed on an empty tab, which loads it; ⌘D in the address bar shows it again, and Remove takes it away.
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
  const star = q(`${V} [data-web-preview-bookmark]`);
  const loaded = `${address}?.value && ${JSON.stringify(url)}.includes(${address}.value.replace(/\\/$/, ''))`;
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${address} && !${address}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, `${V} [data-browser-address]`, url.replace('http://', ''));
  await js(`${address}.form.requestSubmit()`);
  if (!(await waitInPage(win, loaded, 5_000))) return 'the local page did not load in a new tab';
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load';

  // The star: a bookmark, shown at once to name and place.
  await js(`${star}.click()`);
  if (!(await waitInPage(win, `${q('[data-bookmark-dialog]')} && ${q('[data-bookmark-name]')}`, 3_000))) return 'the star did not show the bookmark';
  await setFieldValue(win, '[data-bookmark-folder]', 'Smoke');
  // Also add to favourites can be checked, and unchecked again (no favourite left for later steps).
  const also = q('[data-bookmark-dialog] [data-bookmark-favorite]');
  await js(`${also}.click()`);
  if (!(await waitInPage(win, `${also}.getAttribute('aria-checked') === 'true'`, 2_000))) return 'Also add to favourites could not be checked';
  await js(`${also}.click()`);
  if (!(await waitInPage(win, `${also}.getAttribute('aria-checked') === 'false'`, 2_000))) return 'Also add to favourites could not be unchecked';
  await deps.shot('browser-bookmark');
  await js(`${q('[data-bookmark-done]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-bookmark-dialog]')} && ${star}.getAttribute('aria-pressed') === 'true'`, 3_000))) return 'Done did not keep the bookmark (the star is not pressed)';

  // Kept by the engine: still there after the window reloads, on an empty tab, in its folder.
  await new Promise((resolve) => setTimeout(resolve, 300));
  deps.reload();
  if (!(await waitInPage(win, q('[data-browser-tab-list]'), 15_000))) return 'after the reload the Browser list is gone';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  const listed = q(`${V} [data-web-preview-empty] [data-new-tab-bookmarks] [data-bookmark="${url}"]`);
  if (!(await waitInPage(win, listed, 5_000))) return 'after the reload an empty tab does not list the bookmark';
  if (!(await js(`${q(`${V} [data-web-preview-empty] [data-new-tab-bookmarks]`)}.textContent.includes('Smoke')`))) return 'the bookmark is not in its folder';
  await js(`${listed}.click()`);
  if (!(await waitInPage(win, `!${listed} && ${loaded}`, 5_000))) return "the empty tab's bookmark did not load there";

  // ⌘D in the address bar shows the bookmark again; Remove takes it away.
  await js(`${address}.focus(); ${address}.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ${MOD_KEY_PROPERTY}: true, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, q('[data-bookmark-remove]'), 3_000))) return '⌘D did not show the bookmark';
  await js(`${q('[data-bookmark-remove]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-bookmark-dialog]')} && ${star}.getAttribute('aria-pressed') === 'false'`, 3_000))) return 'Remove did not take the bookmark away';
  return 'ok: bookmarked from the star into a folder, kept after a reload, listed and opened on an empty tab, removed from ⌘D';
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

  // Mute from the palette, then unmute with the muted tab's speaker in the list.
  if (!(await paletteCommand(win, 'Mute tab'))) return 'no Mute tab in the palette';
  if (!(await until(() => page.isAudioMuted(), 3_000))) return 'Mute tab did not mute the page';
  const speaker = q('[data-browser-tab-list] [data-browser-tab-sound][data-browser-tab-muted]');
  if (!(await waitInPage(win, speaker, 3_000))) return 'a muted tab shows no crossed-out speaker in the list';
  await js(`${speaker}.click()`);
  if (!(await until(() => !page.isAudioMuted(), 3_000))) return "the muted tab's speaker did not unmute the page";
  if (!(await waitInPage(win, `!${q('[data-browser-tab-list] [data-browser-tab-sound]')}`, 3_000))) return 'a quiet tab still shows a speaker after Unmute';
  if (!(await paletteCommand(win, 'Mute tab'))) return 'no Mute tab in the palette';
  if (!(await until(() => page.isAudioMuted(), 3_000))) return 'Mute tab did not mute the page a second time';
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
  return 'ok: zoom in (110% in the toolbar) and actual size, mute and unmute (from the palette and the tab\'s speaker), a sign-in window with its opener, a stopped page loaded again, developer tools, Rename tab… and Go to tab… from the palette; Clear data for this site asked and removed the cookie; Clear all asked';
}

/**
 * "browser profiles": Settings › Browser makes two browser profiles (a name another one has is refused); a tab in the
 * first, opened from the new tab menu, keeps a cookie and local storage on a local page; Open in other profile opens
 * the same page in the second, which sees neither; the toolbar's switcher moves that tab to the first (its page then sees
 * the first one's data) and to Default (none); Reset profile… (everything ticked) on the first forgets both, and
 * its tab loads again. Both profiles are deleted again, which closes their tabs.
 */
export async function runBrowserProfilesStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = `${await site()}profile`;
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';

  // Settings › Browser, shown with the browser on.
  await js(`${q('[data-settings]')} || ${q('[data-open-settings]')}.click()`);
  if (!(await waitInPage(win, q('[data-settings-section="browser"]'), 3_000))) return 'no Browser page in Settings with the browser on';
  await js(`${q('[data-settings-section="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-settings-page="browser"] [data-browser-control-setting]')} && ${q('[data-settings-page="browser"] [data-browser-profile="default"]')}`, 3_000))) return 'Settings › Browser has no Allow Seshboard to control the browser or no Default profile';
  if (await js(`!!${q('[data-settings-page="general"]')}`)) return 'Settings still shows General';
  const names = ['Smoke A', 'Smoke B'];
  const ids: string[] = [];
  const idOf = (name: string) => `[...document.querySelectorAll('[data-browser-profile] [data-browser-profile-name]')].find((input) => input.value === ${JSON.stringify(name)})?.closest('[data-browser-profile]')?.dataset.browserProfile`;
  for (const name of names) {
    await js(`${q('[data-new-browser-profile]')}.click()`);
    if (!(await waitInPage(win, q('[data-new-browser-profile-name]'), 2_000))) return 'New profile showed no form';
    await setFieldValue(win, '[data-new-browser-profile-name]', name);
    await js(`${q('[data-new-browser-profile-create]')}.click()`);
    if (!(await waitInPage(win, `!${q('[data-new-browser-profile-form]')} && !!(${idOf(name)})`, 5_000))) return `${name} was not created: ${String(await js(`${q('[data-new-browser-profile-form] [role=alert]')}?.textContent ?? ''`))}`;
    ids.push(String(await js(idOf(name))));
  }
  const [a, b] = ids as [string, string];
  // The same name again, in any case, is refused with a reason.
  await js(`${q('[data-new-browser-profile]')}.click()`);
  await waitInPage(win, q('[data-new-browser-profile-name]'), 2_000);
  await setFieldValue(win, '[data-new-browser-profile-name]', 'smoke a');
  await js(`${q('[data-new-browser-profile-create]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-new-browser-profile-form] [role=alert]')}?.textContent.includes('already there')`, 3_000))) return 'a second profile called smoke a was not refused';
  await js(`[...document.querySelectorAll('[data-new-browser-profile-form] button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
  await deps.shot('browser-profiles-settings');
  await js(`${q('[data-close-settings]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-settings]')}`, 3_000))) return 'Settings did not close';

  // A tab in the first profile, from the new tab menu in the Browser view's list.
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list] [data-browser-new-tab-menu]')}`, 3_000))) return 'the Browser list has no New tab in profile menu';
  await js(`${q('[data-browser-tab-list] [data-browser-new-tab-menu]')}.click()`);
  if (!(await waitInPage(win, q(`[data-browser-new-tab-profile="${a}"]`), 2_000))) return 'the New tab in profile menu does not list the new profile';
  await js(`${q(`[data-browser-new-tab-profile="${a}"]`)}.click()`);
  const address = q('[data-browser-view] [data-browser-address]');
  if (!(await waitInPage(win, `${address} && !${address}.disabled`, 3_000))) return 'the new tab in a profile gave no address bar';
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', url.replace('http://', ''));
  await js(`${address}.form.requestSubmit()`);
  const pageIn = (id: string) => webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.session === session.fromPartition(`persist:browser-${id}`) && c.getURL().startsWith(url) && c.getTitle() === 'Smoke profile');
  if (!(await until(() => pageIn(a) !== undefined, 10_000))) return "the page did not load in the first profile's partition";
  const tabRow = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.querySelector('[data-browser-tab-profile="${a}"]'))`;
  if (!(await waitInPage(win, tabRow, 3_000))) return "the profile's tab shows no mark of its profile in the list";
  await pageIn(a)!.executeJavaScript("localStorage.setItem('smoke-profile', 'A'); document.cookie = 'smoke-profile=A; path=/'; true");
  const stored = async (page: WebContents | undefined) => (page ? String(await page.executeJavaScript("`${localStorage.getItem('smoke-profile')}|${document.cookie}`").catch(() => '?')) : '?');
  if (!(await stored(pageIn(a))).startsWith('A|') || !(await stored(pageIn(a))).includes('smoke-profile=A')) return 'the first profile could not keep its cookie and local storage';

  // Open in other profile: the same page in a new tab of the second, which sees neither.
  await js(`${tabRow}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))`);
  if (!(await waitInPage(win, q('[data-browser-tab-other-profile]'), 2_000))) return "the tab's menu has no Open in other profile";
  await js(`${q('[data-browser-tab-other-profile]')}.click()`);
  if (!(await waitInPage(win, q(`[data-browser-tab-open-in="${b}"]`), 2_000))) return 'Open in other profile does not list the second profile';
  await js(`${q(`[data-browser-tab-open-in="${b}"]`)}.click()`);
  if (!(await until(() => pageIn(b) !== undefined, 10_000))) return "Open in other profile did not load the page in the second profile's partition";
  const other = await stored(pageIn(b));
  if (other !== 'null|') return `the second profile sees the first one's data (${other})`;

  // The toolbar's switcher: the second profile's tab (in front) moves to the first, in its place, and its page now sees
  // the first one's data; then to Default, which sees none. Each time the switcher names the profile.
  const switcher = (id: string) => q(`[data-browser-view] [data-web-preview-toolbar] [data-browser-profile-switch="${id}"]`);
  if (!(await waitInPage(win, `${switcher(b)}?.getAttribute('aria-label') === 'Browser profile: Smoke B' && ${switcher(b)}.textContent.includes('Smoke B')`, 3_000))) return "the toolbar's switcher does not show the tab's profile";
  const listed = () => js("document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]').length") as Promise<number>;
  const tabsBefore = await listed();
  await js(`${switcher(b)}.click()`);
  if (!(await waitInPage(win, `${q(`[data-browser-profile-switch-to="${b}"][aria-checked="true"]`)} || ${q(`[data-browser-profile-switch-to="${b}"]`)}?.closest('[role]')?.getAttribute('aria-checked') === 'true'`, 2_000))) return "the switcher's menu does not check the tab's own profile";
  await deps.shot('browser-profile-switch');
  await js(`${q(`[data-browser-profile-switch-to="${a}"]`)}.click()`);
  if (!(await waitInPage(win, `!!${switcher(a)}`, 3_000))) return 'switching to the first profile did not show it in the toolbar';
  if (!(await until(() => pageIn(b) === undefined, 5_000))) return "the switched tab's page stayed in the second profile";
  let seen = '';
  for (const started = Date.now(); Date.now() - started < 8_000; await new Promise((resolve) => setTimeout(resolve, 150))) {
    const pages = webContents.getAllWebContents().filter((c) => c.getType() === 'webview' && !c.isDestroyed() && c.session === session.fromPartition(`persist:browser-${a}`) && c.getURL().startsWith(url));
    if (pages.length >= 2) seen = (await Promise.all(pages.map(stored))).join(',');
    if (seen && seen.split(',').every((one) => one.startsWith('A|'))) break;
  }
  if (!seen.split(',').every((one) => one.startsWith('A|'))) return `after switching to the first profile the page does not see its data (${seen})`;
  if ((await listed()) !== tabsBefore) return 'switching the profile changed the number of tabs instead of replacing the tab';
  await js(`${switcher(a)}.click()`);
  if (!(await waitInPage(win, q('[data-browser-profile-switch-to="default"]'), 2_000))) return "the switcher's menu has no Default";
  await js(`${q('[data-browser-profile-switch-to="default"]')}.click()`);
  if (!(await waitInPage(win, `!!${switcher('default')} && ${switcher('default')}.getAttribute('aria-label') === 'Browser profile: Default'`, 3_000))) return 'switching to Default did not show it in the toolbar';
  const defaultPage = () => webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.session === session.fromPartition('persist:web-preview') && c.getURL().startsWith(url) && c.getTitle() === 'Smoke profile');
  if (!(await until(() => defaultPage() !== undefined, 8_000))) return 'switching to Default did not load the page in the Default profile';
  if ((await stored(defaultPage())) !== 'null|') return 'the Default profile sees the first one\'s data';

  // The agent's open with a profile (the name already found by the engine's bridge, as it passes it on): a tab of its
  // own in that profile, beside its Default one, so it can use both accounts.
  if (deps.agent) {
    deps.setPrefs({ browserControl: true });
    await js("document.querySelector('[data-go-home]')?.click()");
    await waitInPage(win, "!!document.querySelector('[data-session-list] [data-session-id]')", 3_000);
    await js("document.querySelector('[data-session-list] [data-session-id]')?.click()");
    if (!(await waitInPage(win, "!!document.querySelector('[data-current-session]')", 5_000))) return 'no session on screen for the agent';
    const sessionId = String(await js("document.querySelector('[data-current-session]').dataset.currentSession"));
    const inProfile = await deps.agent({ sessionId, tool: 'open', args: { url, profileId: a, profileName: 'Smoke A' } });
    if (inProfile.error || !inProfile.text.includes('in the browser profile Smoke A')) return `the agent's open in a profile: ${inProfile.text}`;
    const where = await deps.agent({ sessionId, tool: 'where', args: {} });
    if (where.profileId !== a) return `after open in Smoke A the agent's tools work in ${String(where.profileId)}`;
    const agentPages = () => webContents.getAllWebContents().filter((c) => c.getType() === 'webview' && !c.isDestroyed() && c.session === session.fromPartition(`persist:browser-${a}`) && c.getURL().startsWith(url));
    if (!(await until(() => agentPages().length >= 2, 5_000))) return "the agent's page is not in the profile's partition";
    for (const page of agentPages()) if (!(await stored(page)).startsWith('A|')) return "the agent's page in Smoke A does not have the profile's data";
    const plain = await deps.agent({ sessionId, tool: 'open', args: { url } });
    if (plain.error || plain.text.includes('browser profile')) return `the agent's open without a profile: ${plain.text}`;
    if ((await deps.agent({ sessionId, tool: 'where', args: {} })).profileId !== null) return "after open without a profile the agent's tools are not in Default";
    if (!(await waitInPage(win, `document.querySelectorAll('[data-current-session] [data-web-preview-tabs] [data-browser-tab]').length >= 2 && !!${q(`[data-current-session] [data-web-preview-tabs] [data-browser-tab-profile="${a}"]`)}`, 3_000))) return "the session's strip does not show the agent's tab in Smoke A beside its Default one";
    await js(`${q('[data-nav="browser"]')}.click()`);
    if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${tabRow}`, 3_000))) return 'the Browser view did not come back';
  }

  // Reset profile… on the first: everything ticked to start with, then its data is gone and its tab loads again.
  await js(`${tabRow}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))`);
  if (!(await waitInPage(win, q('[data-browser-tab-reset-profile]'), 2_000))) return "the tab's menu has no Reset profile…";
  await js(`${q('[data-browser-tab-reset-profile]')}.click()`);
  const dialog = `[data-reset-browser-profile-dialog="${a}"]`;
  if (!(await waitInPage(win, q(`${dialog} [data-confirm]`), 2_000))) return 'Reset profile… showed no dialog';
  if (!(await js(`document.querySelectorAll('${dialog} [data-reset-part][aria-checked="true"]').length === 4`))) return 'Reset profile… does not start with all four parts ticked';
  if (!(await js(`${q(dialog)}.textContent.includes('Reset Smoke A?') && ${q(dialog)}.textContent.includes('Its tabs reload.')`))) return 'the Reset dialog does not name the profile or say its tabs reload';
  await deps.shot('browser-profile-reset');
  await js(`${q(`${dialog} [data-confirm]`)}.click()`);
  if (!(await waitInPage(win, `!${q(dialog)}`, 8_000))) return 'the Reset dialog stayed';
  let forgotten = '';
  for (const started = Date.now(); Date.now() - started < 8_000; await new Promise((resolve) => setTimeout(resolve, 150))) {
    forgotten = await stored(pageIn(a));
    if (forgotten === 'null|') break;
  }
  if (forgotten !== 'null|') return `after Reset the first profile still has its data (${forgotten})`;

  // Clean up: both profiles deleted, which closes their tabs.
  await js(`${q('[data-open-settings]')}.click()`);
  if (!(await waitInPage(win, q('[data-settings-section="browser"]'), 3_000))) return 'Settings did not open again';
  await js(`${q('[data-settings-section="browser"]')}.click()`);
  for (const id of ids) {
    if (!(await waitInPage(win, q(`[data-browser-profile-delete="${id}"]`), 3_000))) return 'a profile has no Delete button';
    await js(`${q(`[data-browser-profile-delete="${id}"]`)}.click()`);
    if (!(await waitInPage(win, q(`[data-delete-browser-profile-dialog="${id}"] [data-confirm]`), 2_000))) return 'Delete profile did not ask first';
    await js(`${q(`[data-delete-browser-profile-dialog="${id}"] [data-confirm]`)}.click()`);
    if (!(await waitInPage(win, `!${q(`[data-browser-profile="${id}"]`)}`, 8_000))) return 'a deleted profile stayed in the list';
  }
  await js(`${q('[data-close-settings]')}.click()`);
  if (!(await waitInPage(win, `!${q('[data-browser-tab-profile]')}`, 3_000))) return "a deleted profile's tab is still open";
  return `ok: two browser profiles made in Settings › Browser (a taken name refused), a tab in the first from the new tab menu kept a cookie and local storage, Open in other profile showed the second sees neither, the toolbar's switcher moved that tab to the first (which saw its data) and to Default (which did not),${deps.agent ? " the agent's open used the profile's own tab and data beside its Default one," : ''} Reset with all four ticked forgot them and reloaded the tab, both deleted with their tabs`;
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

/**
 * "browser link": `seshboard://open?url=…` (what LinkLane sends) opens the page in a tab of the Browser view, and the
 * same link again brings that tab forward instead of a second one. A file: address is refused, and with the browser off
 * the link says where to turn it on. Leaves the browser on, with the tab closed.
 */
export async function runBrowserLinkStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!deps.openLink) return 'no way to open a link';
  const page = `${await site()}from-link`;
  const link = `seshboard://open?url=${encodeURIComponent(page)}`;
  const rows = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].filter((t) => t.textContent.includes('Smoke from a link'))`;
  const error = q('[data-link-error]');
  const dismiss = async () => {
    await js(`${error}?.querySelector('button')?.click()`);
    await waitInPage(win, `!${error}`, 2_000);
  };
  deps.setBrowser(true);
  await dismiss();
  deps.openLink(link);
  if (!(await until(() => pageWithTitle('Smoke from a link') !== undefined, 10_000))) return 'the link did not load its page';
  // The panel may show another list beside the Browser view (Sessions picked there): Browser on the nav rail shows its tabs.
  if (!(await waitInPage(win, q('[data-browser-tab-list]'), 1_000))) await js(`${q('[data-nav="browser"]')}?.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${rows}.length === 1`, 3_000))) return `the page is not a tab of the Browser view (${String(await js(`${rows}.length`))} tabs)`;
  deps.openLink(link);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if ((await js(`${rows}.length`)) !== 1) return 'the same link again opened a second tab';
  deps.openLink(`seshboard://open?url=${encodeURIComponent('file:///etc/hosts')}`);
  if (!(await waitInPage(win, `${error}?.innerText.includes('http and https')`, 3_000))) return 'a file: address showed no error';
  await dismiss();
  deps.setBrowser(false);
  deps.openLink(link);
  const off = await waitInPage(win, `${error}?.innerText.includes('Turn on Allow browser')`, 3_000);
  await dismiss();
  deps.setBrowser(true);
  if (!off) return 'with the browser off the link showed no error';
  await js(`${rows}[0]?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  if (!(await waitInPage(win, `${rows}.length === 0`, 3_000))) return 'could not close the tab the link opened';
  return 'ok: a link opened its page in the Browser view, again brought the same tab forward, refused file: and said to turn the browser on';
}

/**
 * "browser download": a link to a file saves it in the Downloads folder (the profile's, in a smoke run). While it runs,
 * a toast says so, its long name cut, and Show all shows the whole name. Once done, a toast offers to show the file.
 */
export async function runBrowserDownloadStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  const address = '[data-browser-view] [data-browser-address]';
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-list] [data-browser-open-tab]'), 3_000))) return 'no Browser view';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${q(address)} && !${q(address)}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, address, `${url.replace('http://', '')}download`);
  await js(`${q(address)}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke download') !== undefined, 10_000))) return 'the page with the file did not load';
  heldDownload = null;
  await pageWithTitle('Smoke download')!.executeJavaScript("document.getElementById('file').click()", true);
  const started = q('[data-web-preview-download="started"]');
  if (!(await waitInPage(win, started, 5_000))) return `no Downloading toast after the link was clicked (the server ${heldDownload ? 'sent the file' : 'had no request'}, toasts: ${String(await js(`[...document.querySelectorAll('[data-toast]')].map((t) => t.textContent).join(' | ')`))})`;
  if (!(await until(() => heldDownload !== null, 3_000))) return 'the download did not reach the server';
  if ((await js(`${started}.querySelector('[data-toast-text]')?.dataset.toastText`)) !== 'cut') return "the Downloading toast's long name is not cut";
  await js(`${started}.querySelector('[data-toast-expand]').click()`);
  if (!(await waitInPage(win, `${started}?.querySelector('[data-toast-text]')?.dataset.toastText === 'open' && ${started}.textContent.includes(${JSON.stringify(DOWNLOAD_NAME)})`, 2_000))) return 'Show all did not show the whole name';
  await deps.shot('browser-download');
  (heldDownload as ServerResponse | null)?.end(DOWNLOAD_TEXT.slice(8));
  const done = q('[data-web-preview-download="done"]');
  if (!(await waitInPage(win, `${done} && ${q('[data-web-preview-download-show]')} && !${started}`, 5_000))) return `no Downloaded toast with Show in Finder (failed: ${String(await js(`!!${q('[data-web-preview-download="failed"]')}`))})`;
  const file = join(deps.downloadsDir, DOWNLOAD_NAME);
  if (!existsSync(file) || readFileSync(file, 'utf8') !== DOWNLOAD_TEXT) return `the file is not in the Downloads folder as it was sent (${file})`;
  await js(`${done}.querySelector('[data-toast-close]')?.click()`);
  return 'ok: the file saved in the Downloads folder, its long name cut and shown in full, Show in Finder offered';
}

/**
 * "browser stop": the ✕ next to the address stops a new tab's first load, a page that hasn't answered yet (so has no
 * `dom-ready`), and gives Reload back. The tab is closed after.
 */
export async function runBrowserStopStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  const address = '[data-browser-view] [data-browser-address]';
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
  if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, q('[data-browser-tab-list] [data-browser-open-tab]'), 3_000))) return 'no Browser view';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${q(address)} && !${q(address)}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, address, `${url.replace('http://', '')}slow`);
  await js(`${q(address)}.form.requestSubmit()`);
  const stop = q('[data-browser-view] [data-web-preview-stop]');
  try {
    if (!(await waitInPage(win, stop, 5_000))) return 'no Stop loading button while the page loads';
    if (!(await until(() => heldSlow.length > 0, 5_000))) return 'the page did not reach the server';
    await js(`${stop}.click()`);
    if (!(await waitInPage(win, `!${stop} && ${q('[data-browser-view] [data-web-preview-reload]')}`, 3_000))) return 'Stop loading did not stop the first load: the page is still loading';
  } finally {
    for (const response of heldSlow.splice(0)) response.destroy();
    // The tab in front is the one this step opened.
    await js(`${q('[data-browser-tab-list] [data-browser-tab][aria-current="page"]')}?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  }
  return 'ok: Stop loading stopped a first load that had not answered, and Reload came back';
}

/**
 * "browser text page": in the dark, JSON and XML that Chromium shows as text get a dark canvas under their light text,
 * not the white of the page's `<webview>`.
 */
export async function runBrowserTextPageStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  const address = '[data-browser-view] [data-browser-address]';
  deps.setBrowser(true);
  deps.setPrefs({ colorScheme: 'dark' });
  try {
    if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with the browser on';
    if (!(await js(`!!${q('[data-browser-tab-list]')}`))) await js(`${q('[data-nav="browser"]')}.click()`);
    if (!(await waitInPage(win, q('[data-browser-tab-list] [data-browser-open-tab]'), 3_000))) return 'no Browser view';
    // The tabs already open, so the ones this step opens can be closed again: later steps (browser pin) work on the
    // tab in front, and expect the Smoke browser tab there.
    const tabIds = `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].map((t) => t.dataset.browserTab)`;
    const before = (await js(tabIds)) as string[];
    const seen: string[] = [];
    for (const path of Object.keys(RAW)) {
      await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
      if (!(await waitInPage(win, `${q(address)} && !${q(address)}.disabled`, 3_000))) return 'Open tab gave no address bar';
      await setFieldValue(win, address, `${url.replace('http://', '')}${path.slice(1)}`);
      await js(`${q(address)}.form.requestSubmit()`);
      let page: WebContents | undefined;
      if (!(await until(() => (page = webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.getURL().endsWith(path))) !== undefined, 10_000))) return `${path} did not load`;
      // The canvas comes on dom-ready, after the page shows.
      const colours = `(() => { const style = getComputedStyle(document.documentElement); const text = getComputedStyle(document.body ?? document.documentElement).color; return style.backgroundColor + ' / ' + text; })()`;
      const dark = `(() => { const rgb = getComputedStyle(document.documentElement).backgroundColor.match(/\\d+/g)?.map(Number) ?? []; return rgb.length === 3 && rgb[0] + rgb[1] + rgb[2] < 200; })()`;
      if (!(await waitInPage({ webContents: page! }, dark, 3_000))) return `${path} has no dark canvas in the dark (background / text: ${String(await page!.executeJavaScript(colours).catch(() => '?'))})`;
      seen.push(`${path} ${String(await page!.executeJavaScript(colours))}`);
    }
    await deps.shot('browser-text-page');
    const opened = ((await js(tabIds)) as string[]).filter((id) => !before.includes(id));
    for (const id of opened) await js(`${q(`[data-browser-tab-list] [data-browser-tab="${id}"]`)}?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
    if (!(await waitInPage(win, `${tabIds}.length === ${before.length}`, 3_000))) return `the ${opened.length} tabs it opened did not close on a middle click`;
    return `ok: dark canvas under ${seen.join(', ')}`;
  } finally {
    deps.setPrefs({ colorScheme: 'system' });
  }
}
