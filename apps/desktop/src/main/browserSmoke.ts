import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { webContents, type BrowserWindow, type WebContents } from 'electron';
import { setFieldValue, until, waitInPage } from './pageDriver.ts';
import { MOD_KEY_PROPERTY } from './smokeKeys.ts';

// The smoke steps for Browser (preview) (Settings › General). A tiny server on this computer (Node's own http module, on
// a free port) stands in for the web, so no outside site is needed: a page with a title, a link to a second one, and a
// link that leaves for example.com.

const PAGES: Record<string, string> = {
  '/': '<title>Smoke browser</title><h1>One</h1><a id=next href=/two>Two</a> <a id=out href=https://example.com/>Out</a>',
  '/two': '<title>Smoke browser two</title><h1>Two</h1>',
};

export interface BrowserSmokeDeps {
  /** Saves a screenshot in light and in dark (`name-light.png`, `name-dark.png`), for the pull request. */
  shot(name: string): Promise<void>;
  /** Sets Browser (preview) on or off, as Settings would. */
  setBrowser(on: boolean): void;
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
 * "browser view": Browser in the sidebar's views shows the Browser view with its tabs listed; Open tab gives an empty
 * tab with the address bar; the local page loads there, and its title shows in the list.
 */
export async function runBrowserViewStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(true);
  if (!(await waitInPage(win, q('[data-nav="browser"]'), 3_000))) return 'no Browser icon in the sidebar with Browser (preview) on';
  for (const nav of ['home', 'upcoming', 'activity']) if (!(await js(`!!${q(`[data-nav="${nav}"]`)}`))) return `no ${nav} icon in the sidebar's views`;
  await js(`${q('[data-nav="browser"]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view]')} && ${q('[data-browser-tab-list]')}`, 3_000))) return 'Browser did not show the Browser view and its tab list';
  if (!(await js(`!!${q('[data-browser-view] [data-browser-empty]')} || !!${q('[data-browser-view] [data-web-preview-slot]')}`))) return 'the Browser view shows neither a page nor its empty state';
  await js(`${q('[data-browser-tab-list] [data-browser-open-tab]')}.click()`);
  if (!(await waitInPage(win, `${q('[data-browser-view] [data-browser-address]')} && !${q('[data-browser-view] [data-browser-address]')}.disabled`, 3_000))) return 'Open tab gave no address bar';
  await setFieldValue(win, '[data-browser-view] [data-browser-address]', url.replace('http://', ''));
  await js(`${q('[data-browser-view] [data-browser-address]')}.form.requestSubmit()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the local page did not load in the Browser view';
  if (!(await waitInPage(win, `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].some((t) => t.textContent.includes('Smoke browser'))`, 3_000))) return "the page's title is not in the tab list";
  await deps.shot('browser-view');
  return `ok: ${url} opened in a Browser tab, its title in the list`;
}

/** "browser pin": pinned, the tab is still in the list with its pin after the window reloads. Needs "browser view" first. */
export async function runBrowserPinStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const listed = (pinned: boolean) => `[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]${pinned ? '[data-browser-pinned]' : ''}')].some((t) => t.textContent.includes('Smoke browser'))`;
  if (!(await waitInPage(win, `${q('[data-browser-view] [data-web-preview-pin]')} && ${listed(false)}`, 3_000))) return 'no Smoke browser tab to pin (run "browser view" first)';
  await js(`${q('[data-browser-view] [data-web-preview-pin]')}.click()`);
  if (!(await waitInPage(win, listed(true), 3_000))) return 'Pin tab did not mark the tab pinned in the list';
  // The engine saves a new pin at once; give the call a moment to land before the window goes.
  await new Promise((resolve) => setTimeout(resolve, 500));
  deps.reload();
  if (!(await waitInPage(win, `${q('[data-nav="browser"]')} && ${q('[data-browser-tab-list]')}`, 15_000))) return 'after the reload the sidebar does not list the Browser tabs again';
  if (!(await waitInPage(win, listed(true), 5_000))) return `after the reload the pinned tab is gone (${String(await js(`[...document.querySelectorAll('[data-browser-tab]')].map((t) => t.textContent).join(', ')`))})`;
  // Shown again, its page loads only now.
  await js(`[...document.querySelectorAll('[data-browser-tab-list] [data-browser-tab]')].find((t) => t.textContent.includes('Smoke browser')).click()`);
  if (!(await until(() => pageWithTitle('Smoke browser') !== undefined, 10_000))) return 'the restored tab did not load its page when shown';
  // Leave nothing pinned for later runs on the same profile.
  await js(`${q('[data-browser-view] [data-web-preview-pin]')}.click()`);
  if (!(await waitInPage(win, `!(${listed(true)})`, 3_000))) return 'Unpin tab left the pin';
  return 'ok: pinned, kept across a reload, loaded when shown, unpinned';
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
  return 'ok: the reply link opened in the session panel, the row shows the globe';
}

/**
 * "browser outside link": with Browser (preview) off, the panel is the web preview as before: a local page loads, and
 * its link to example.com goes to the browser (recorded) while the page stays.
 */
export async function runBrowserOutsideLinkStep(win: BrowserWindow, deps: BrowserSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const url = await site();
  deps.setBrowser(false);
  if (!(await waitInPage(win, `!${q('[data-nav="browser"]')}`, 3_000))) return 'the Browser icon stayed with Browser (preview) off';
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
  if (await js(`!!${q(`${S} [data-web-preview-tabs]`)} || !!${q(`${S} [data-web-preview-pin]`)}`)) return 'the web preview shows tabs or a pin with Browser (preview) off';
  await js(`${q(`${S} [data-web-preview-close]`)}.click()`);
  return 'ok: with Browser (preview) off, the outside link went to the browser and the page stayed';
}
