import { webContents, type BrowserWindow, type WebContents } from 'electron';
import { setFieldValue, until, waitInPage } from './pageDriver.ts';
import { MOD_MODIFIER } from './smokeKeys.ts';

// The smoke step for the web preview (#296). A project action starts a tiny server on this computer (Node's own http
// module, on a free port), the step opens its page beside the conversation, then stops the action.

const S = '[data-current-session]';
const q = (selector: string) => `document.querySelector(${JSON.stringify(`${S} ${selector}`)})`;

/** A page with a title to wait for and a link that leaves the computer. No `$` or `${`: actions expand those. */
const SERVER = `node -e "const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Smoke site</title><h1>Smoke site</h1><a id=out href=https://example.com/>Out</a>')});s.listen(0,'127.0.0.1',()=>console.log('  Local:   http://127.0.0.1:'+s.address().port+'/'))"`;

export interface WebPreviewSmokeDeps {
  shot(name: string): Promise<void>;
  /** Adds a project action through the editor. */
  addAction(name: string, command: string): Promise<boolean>;
  /** The outside addresses the preview sent to the browser (recorded, not opened, in a smoke run). */
  outside: readonly string[];
  /** A session's pop-out window, while it has one. */
  popoutOf(sessionId: string): BrowserWindow | undefined;
}

/** Every preview page, in every window. */
const previewPages = (): WebContents[] => webContents.getAllWebContents().filter((c) => c.getType() === 'webview' && !c.isDestroyed());
/** The preview's page, once its `<webview>` attached. */
const previewPage = (): WebContents | undefined => previewPages()[0];
/** There is one page, in `win`, showing the smoke site. */
const onlyPageIn = (win: BrowserWindow) => {
  const pages = previewPages();
  return pages.length === 1 && pages[0]!.hostWebContents === win.webContents && pages[0]!.getTitle() === 'Smoke site';
};

/**
 * A project action that starts a server offers Open preview on its run strip and its pill; the preview opens on the
 * address, shows the page with its toolbar hooks, keeps an outside link out (it goes to the browser), refuses an outside
 * address in the address bar, keeps its page while another tab is in front, hands the app's shortcuts typed in the page
 * to the app, toggles the phone width, and goes with the session to its own window and back, one page at a time.
 */
export async function runWebPreviewStep(win: BrowserWindow, deps: WebPreviewSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  if (!(await deps.addAction('Smoke server', SERVER))) return 'could not add the action, or saving did not close the editor';
  await js(`${q('[data-actions-menu]')}.click()`);
  if (!(await waitInPage(win, "document.querySelector('[role=menuitem][data-action=\"smoke-server\"]')", 3_000))) return 'the action is not in the menu';
  await js("document.querySelector('[role=menuitem][data-action=\"smoke-server\"]').click()");
  try {
    // Found in the output by the engine: on the run strip, and on the pill when the action has one.
    if (!(await waitInPage(win, `${q('[data-terminal-open-preview]')}`, 15_000))) {
      const status = (await js(`${q('[data-terminal-run-status]')}?.innerText ?? 'no run strip'`)) as string;
      return `no Open preview on the run strip (the action says "${status}")`;
    }
    const url = (await js(`${q('[data-terminal-open-preview]')}.dataset.terminalOpenPreview`)) as string;
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) return `the offer is for ${url}`;
    const pill = (await js(`!!${q('[data-action-pill="smoke-server"]')} ? !!${q('[data-action-preview="smoke-server"]')} : null`)) as boolean | null;
    if (pill === false) return 'the action pill has no Open preview';
    await deps.shot('web-preview-offer.png');

    await js(`${q('[data-terminal-open-preview]')}.click()`);
    if (!(await waitInPage(win, `${q('[data-web-preview]')}`, 5_000))) return 'Open preview did not open the Web tab in front';
    for (const hook of ['back', 'forward', 'address', 'phone', 'open-external']) {
      if (!(await js(`!!${q(`[data-web-preview-${hook}]`)}`))) return `the toolbar has no data-web-preview-${hook}`;
    }
    if (!(await until(() => previewPage() !== undefined, 5_000))) return 'no page attached in the web preview';
    const page = previewPage()!;
    if (!(await until(() => page.getTitle() === 'Smoke site', 10_000))) return `the page did not load (title "${page.getTitle()}", at ${page.getURL()})`;
    const address = (await js(`${q('[data-web-preview-address]')}.value`)) as string;
    if (!url.includes(address)) return `the address bar says "${address}" for ${url}`;
    await deps.shot('web-preview.png');

    // An outside link goes to the browser; the page stays.
    await page.executeJavaScript("document.getElementById('out').click()");
    if (!(await until(() => deps.outside.includes('https://example.com/'), 3_000))) return `the outside link was not sent to the browser (sent: ${JSON.stringify(deps.outside)})`;
    if (!page.getURL().startsWith(url)) return `the page left for ${page.getURL()}`;
    // So does an outside address typed in the address bar: refused, the page stays.
    await setFieldValue(win, `${S} [data-web-preview-address]`, 'example.com');
    await js(`${q('[data-web-preview-address]')}.form.requestSubmit()`);
    if (!(await waitInPage(win, `${q('[data-web-preview-refused]')}`, 2_000))) return 'an outside address in the address bar was not refused';
    if (!page.getURL().startsWith(url)) return `the address bar took the page to ${page.getURL()}`;

    // The page sits over its panel's slot, and is parked off screen while the slot isn't shown.
    const over = `(() => { const a = ${q('[data-web-preview-slot]')}?.getBoundingClientRect(), b = document.querySelector('[data-web-preview-page]').getBoundingClientRect(); return !!a && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1; })()`;
    const parked = "document.querySelector('[data-web-preview-page]').getBoundingClientRect().right < 0";
    if (!(await waitInPage(win, over, 2_000))) return 'the page is not over the Web tab';

    // Behind another tab the page keeps running: the same page, with what it had in memory.
    await page.executeJavaScript('window.__smokeKept = 1');
    const keptPage = () => previewPage() === page && page.executeJavaScript('window.__smokeKept').then((v) => v === 1);
    const kept = (await js(`!!${q('[data-toggle-changes]')}`)) as boolean;
    if (kept) {
      await js(`${q('[data-toggle-changes]')}.click()`);
      if (!(await waitInPage(win, `!${q('[data-web-preview]')} && ${q('[data-toggle-web]')}?.dataset.railState === 'behind' && ${parked}`, 3_000))) return 'the page did not go out of sight behind Changes';
      await js(`${q('[data-toggle-web]')}.click()`);
      if (!(await waitInPage(win, `${q('[data-web-preview]')} && ${over}`, 3_000))) return 'the page did not come back over the Web tab';
      if (!(await keptPage())) return 'the page was loaded again after another tab was in front';
      // Behind Web, the first click brings Changes to the front and the second closes it.
      await js(`${q('[data-toggle-changes]')}.click()`);
      await waitInPage(win, `${q('[data-toggle-changes]')}?.dataset.railState === 'front'`, 2_000);
      await js(`${q('[data-toggle-changes]')}.click()`);
      if (!(await waitInPage(win, `${q('[data-toggle-changes]')}?.dataset.railState === 'closed' && ${over}`, 3_000))) return 'closing Changes did not bring the page back';
    }
    // And while another session is on screen.
    const here = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;
    const other = (await js(`[...document.querySelectorAll('[data-session-id]')].map((r) => r.dataset.sessionId).find((id) => id !== ${JSON.stringify(here)}) ?? null`)) as string | null;
    if (other) {
      await js(`document.querySelector('[data-session-id=${JSON.stringify(other)}]').click()`);
      if (!(await waitInPage(win, `document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(other)} && ${parked}`, 5_000))) return 'the page did not go out of sight with another session on screen';
      await js(`document.querySelector('[data-session-id=${JSON.stringify(here)}]').click()`);
      if (!(await waitInPage(win, `document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(here)} && ${q('[data-web-preview]')} && ${over}`, 5_000))) return `the page did not come back with its session (${JSON.stringify(await js(`({ current: document.querySelector('[data-current-session]')?.dataset.currentSession === ${JSON.stringify(here)}, panel: !!${q('[data-web-preview]')}, tools: [...document.querySelectorAll('${S} [data-rail-tool]')].map((t) => t.dataset.railTool + ':' + t.dataset.railState), slot: ${q('[data-web-preview-slot]')}?.getBoundingClientRect().toJSON(), page: document.querySelector('[data-web-preview-page]')?.getBoundingClientRect().toJSON(), covered: ${q('[data-web-preview-slot]')}?.dataset.covered })`))})`;
      if (!(await keptPage())) return 'the page was loaded again after another session was on screen';
    }

    // ⌘K typed in the page opens the palette: main hands the app's keys over. Focus in the page still counts as the window
    // in front, so the session can be marked read (useMarkRead).
    win.focus();
    // A real click in the page, as a person gives it the focus (focus() from a script leaves the app's own element focused).
    // Near its top: a toast in the window's corner (the update notice on the runners) covers the bottom of the page.
    const at = (await js("(() => { const r = document.querySelector('[data-web-preview-page]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 20) }; })()")) as { x: number; y: number };
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    // Only a window in front gives a page the keyboard (`focusedFrame`; every page of a focused window reports
    // `isFocused()`). Another app in front during the run: these two checks are skipped, not failed.
    if (!(await waitInPage(win, "document.activeElement?.tagName === 'WEBVIEW'", 2_000))) return 'a click in the page did not give it the focus in the window';
    // The page's own process confirms the focus a moment later and sets it again; a person's ⌘K comes long after.
    await new Promise((resolve) => setTimeout(resolve, 300));
    let inFront = win.isFocused();
    if (inFront) {
      await until(() => page.focusedFrame !== null, 2_000);
      // Focus moving into the page blurs the window's document first; useMarkRead looks after that event.
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (page.focusedFrame === null) {
        // A window can say it is focused while macOS keeps another app active (a run started from a terminal or an
        // agent): then no page gets a focused frame, not even from focus(). Only a page that can take it fails here.
        page.focus();
        if (await until(() => page.focusedFrame !== null, 1_000)) return 'a click in the page did not give it the focus';
        inFront = false;
      }
    }
    if (inFront && !(await js('document.hasFocus()'))) return 'with the focus in the page, the window counts as behind: its session would never be marked read';
    page.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [MOD_MODIFIER] });
    page.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: [MOD_MODIFIER] });
    if (!(await waitInPage(win, "document.querySelector('[data-command-palette]')", 3_000))) return 'the palette key typed in the page did not reach the app';
    // The palette's field has the focus, and what is typed in the page now goes there: Chromium leaves the keyboard
    // with the page, so main sends its keys to the window.
    if (!(await waitInPage(win, "document.activeElement?.matches('[data-palette-input]')", 2_000))) return 'the palette opened from the page without the focus in its field';
    await page.executeJavaScript("window.__typed = ''; addEventListener('keydown', (e) => { window.__typed += e.key; }, true)");
    for (const type of ['keyDown', 'char', 'keyUp'] as const) page.sendInputEvent({ type, keyCode: 'z' });
    if (!(await waitInPage(win, "document.querySelector('[data-palette-input]')?.value.endsWith('z')", 2_000))) return `typed in the page after ⌘K, the key did not reach the palette (the page got "${String(await page.executeJavaScript('window.__typed'))}")`;
    await js("document.querySelector('[data-command-palette] input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitInPage(win, "!document.querySelector('[data-command-palette]')", 2_000);
    // A click in the page gives it its keys back.
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    page.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
    page.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const type of ['keyDown', 'char', 'keyUp'] as const) page.sendInputEvent({ type, keyCode: 'q' });
    let back = false;
    for (const started = Date.now(); !back && Date.now() - started < 2_000; await new Promise((resolve) => setTimeout(resolve, 50))) back = String(await page.executeJavaScript('window.__typed')).includes('q');
    if (!back) return 'after a click in the page, its keys still went to the window';

    await js(`${q('[data-web-preview-phone]')}.click()`);
    if (!(await waitInPage(win, `${q('[data-web-preview-phone]')}.getAttribute('aria-pressed') === 'true' && Math.round(document.querySelector('[data-web-preview-page]').getBoundingClientRect().width) === 390`, 2_000))) return 'the phone width did not show the page 390px wide';
    await deps.shot('web-preview-phone.png');
    await js(`${q('[data-web-preview-phone]')}.click()`);

    // In its own window the session has its page there, at the same address, and the main window drops its own.
    const popped = await popOutAndBack(win, deps, url);
    if (popped) return popped;
    return `ok: ${url} offered and shown, kept ${kept ? 'behind Changes' : '(no Changes to check behind)'} and ${other ? 'with another session on screen' : '(no other session to check)'}, ${inFront ? 'a click in the page keeps the window in front' : 'focus not checked (another app in front)'}, one page went with the session to its own window and back, the outside link went to the browser, the palette key reached the app, the phone width is 390px`;
  } finally {
    await js(`${q('[data-web-preview-close]')}?.click()`);
    await js(`${q('[data-terminal-stop]')}?.click()`);
    await waitInPage(win, `!${q('[data-terminal-stop]')}`, 8_000);
    await js(`${q('[data-toggle-terminal]')}?.click()`);
  }
}

/** Pops the session out with its web preview open, checks there is one page and it is the pop-out's, then moves it back. Null when all went well. */
async function popOutAndBack(win: BrowserWindow, deps: WebPreviewSmokeDeps, url: string): Promise<string | null> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const id = (await js("document.querySelector('[data-current-session]').dataset.currentSession")) as string;
  if (!(await js(`!!${q('[data-open-in-new-window]')}`))) return 'the session has no Open in new window button';
  await js(`${q('[data-open-in-new-window]')}.click()`);
  if (!(await until(() => deps.popoutOf(id) !== undefined, 5_000))) return 'the pop-out did not open';
  const pop = deps.popoutOf(id)!;
  const address = "(document.querySelector('[data-web-preview] [data-web-preview-address]')?.value ?? '')";
  if (!(await waitInPage(pop, `${address} !== '' && ${JSON.stringify(url)}.includes(${address})`, 20_000))) return 'the web preview did not open in the pop-out at its address';
  if (!(await until(() => onlyPageIn(pop), 10_000))) return `after the pop-out opened there are ${previewPages().length} pages, ${previewPages().filter((p) => p.hostWebContents === win.webContents).length} of them in the main window`;
  await pop.webContents.executeJavaScript("document.querySelector('[data-move-to-main-window]').click()");
  if (!(await until(() => deps.popoutOf(id) === undefined, 5_000))) return 'Move back to main window did not close the pop-out';
  if (!(await waitInPage(win, `!!${q('[data-web-preview]')}`, 8_000))) return 'the web preview did not come back to the main window';
  if (!(await until(() => onlyPageIn(win), 10_000))) return `after moving back there are ${previewPages().length} pages, ${previewPages().filter((p) => p.hostWebContents === win.webContents).length} of them in the main window`;
  return null;
}
