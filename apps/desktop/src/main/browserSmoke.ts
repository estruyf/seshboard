import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { session, webContents, type BrowserWindow, type WebContents } from 'electron';
import { BROWSER_PARTITION } from '@seshboard/protocol/client';
import { setFieldValue, until, waitInPage } from './pageDriver.ts';

// The smoke step for the browser view. A tiny server on this computer (Node's own http module, on a free port) stands in
// for GitHub, so the step needs no network: two pages with a link between them.

const PAGES: Record<string, string> = {
  '/': '<title>Smoke browser</title><h1>One</h1><a id=next href=/two>Two</a>',
  '/two': '<title>Smoke browser two</title><h1>Two</h1>',
};

/** The browser's page, once its `<webview>` attached. */
const browserPage = (): WebContents | undefined => {
  const partition = session.fromPartition(BROWSER_PARTITION);
  return webContents.getAllWebContents().find((c) => c.getType() === 'webview' && !c.isDestroyed() && c.session === partition);
};

/** Where the page element sits: over its slot, or parked off screen. */
const PLACED = "(() => { const p = document.querySelector('[data-browser-page]'); return !!p && p.style.left !== '-100000px'; })()";
const PARKED = "(() => { const p = document.querySelector('[data-browser-page]'); return !!p && p.style.left === '-100000px'; })()";

/**
 * Browser in the sidebar opens the browser view; an address typed in its bar loads, a link and Back work, a
 * session parks the page without dropping it, Browser brings back the same page on the same address, and Close drops
 * it and goes Home.
 */
export async function runBrowserStep(win: BrowserWindow, shot: (name: string) => Promise<void>): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const server = createServer((request, response) => {
    const body = PAGES[request.url ?? ''];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    response.end(body ?? 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    if (!(await js("!!document.querySelector('[data-browser-nav]')"))) return 'the sidebar has no Browser';
    await js("document.querySelector('[data-browser-nav]').click()");
    if (!(await waitInPage(win, "document.querySelector('[data-browser]')", 3_000))) return 'Browser did not open the browser view';
    for (const hook of ['back', 'forward', 'address', 'open-external', 'close']) {
      if (!(await js(`!!document.querySelector('[data-browser-${hook}]')`))) return `the toolbar has no data-browser-${hook}`;
    }

    await setFieldValue(win, '[data-browser-address]', url.replace('http://', ''));
    await js("document.querySelector('[data-browser-address]').form.requestSubmit()");
    if (!(await until(() => browserPage() !== undefined, 5_000))) return 'no page attached in the browser';
    const page = browserPage()!;
    if (!(await until(() => page.getTitle() === 'Smoke browser', 10_000))) return `the page did not load (title "${page.getTitle()}", at ${page.getURL()})`;
    if (!(await waitInPage(win, PLACED, 3_000))) return 'the page is not over the browser view';
    await shot('browser.png');

    // A link, then Back.
    // As a user's click: Chromium leaves a page that moves on by itself out of Back.
    await page.executeJavaScript("document.getElementById('next').click()", true);
    if (!(await until(() => page.getTitle() === 'Smoke browser two', 5_000))) return `the link did not load (title "${page.getTitle()}")`;
    if (!(await waitInPage(win, "!document.querySelector('[data-browser-back]').disabled", 3_000))) return 'Back stayed off after a link';
    await js("document.querySelector('[data-browser-back]').click()");
    if (!(await until(() => page.getTitle() === 'Smoke browser', 5_000))) return `Back did not go back (title "${page.getTitle()}")`;

    // A session and back: the same page, on the same address, parked in between. Only looked at, never typed into.
    const id = (await js("document.querySelector('[data-session-list] [data-session-id]')?.dataset.sessionId ?? null")) as string | null;
    if (!id) return 'no session in the sidebar to switch to';
    await js(`document.querySelector('[data-session-list] [data-session-id=${JSON.stringify(id)}]').click()`);
    if (!(await waitInPage(win, `!document.querySelector('[data-browser]') && document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(id)}`, 5_000))) return 'clicking a session did not leave the browser for it';
    if (!(await waitInPage(win, PARKED, 3_000))) return 'the page stayed on screen over the session';
    if (page.isDestroyed()) return 'leaving the browser dropped its page';
    await js("document.querySelector('[data-browser-nav]').click()");
    if (!(await waitInPage(win, `document.querySelector('[data-browser]') && ${PLACED}`, 3_000))) return 'the page did not come back over the browser view';
    if (browserPage() !== page) return 'coming back made another page';
    if (page.getURL() !== url) return `the page came back on ${page.getURL()}`;
    const address = (await js("document.querySelector('[data-browser-address]').value")) as string;
    if (!url.includes(address)) return `the address bar says "${address}" for ${url}`;

    await js("document.querySelector('[data-browser-close]').click()");
    if (!(await waitInPage(win, "!document.querySelector('[data-browser]') && !document.querySelector('[data-browser-page]')", 3_000))) return 'Close did not drop the page';
    if (!(await until(() => browserPage() === undefined, 3_000))) return 'the page lived on after Close';
    return `ok: ${url} opened from the address bar, a link and Back, kept while a session was on screen, closed`;
  } finally {
    server.close();
    if (await js("!!document.querySelector('[data-browser-close]')")) await js("document.querySelector('[data-browser-close]').click()");
  }
}
