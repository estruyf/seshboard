import { app, ipcMain, session, webContents, type BrowserWindow, type WebContents } from 'electron';
import { IpcChannel, siteOf, type BrowserAgentTarget, type BrowserAgentTargetRequest, type BrowserToolRequest, type BrowserToolResult } from '@seshboard/protocol/bridge';
import { WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { CONSOLE_KEEP, consoleLevel, consoleText, focusScript, keyEvents, locateScript, SNAPSHOT_SCRIPT, snapshotText, type ConsoleEntry } from './browserAgentScripts.ts';

/*
 * Browser control (docs/browser.md): the engine hands each browser tool call to main, which drives the session's
 * page. The window that shows the session (its pop-out, or the main window) says which page that is and opens it
 * (`BrowserAgentTargetRequest`); main then reads it with a script and clicks and types with input events, as a person
 * would. Which sites a call may touch was decided before it got here, in the engine's permission check.
 */

export interface BrowserAgentDeps {
  /** The window that shows a session: its pop-out, or the main window. */
  windowFor(sessionId: string): BrowserWindow | null;
  /** Settings › General: the browser on, and Allow Seshboard to control the browser. */
  enabled(): boolean;
}

/** How long a page may take to load before `open` answers anyway. */
const LOAD_MS = 20_000;
/** How long a window may take to say which page it is. */
const TARGET_MS = 8_000;
/** The widest picture `screenshot` sends, so a large window doesn't cost too much of Claude's context. */
const SHOT_WIDTH = 1280;

const fail = (text: string): BrowserToolResult => ({ text, error: true });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function installBrowserAgent(deps: BrowserAgentDeps): { run(request: BrowserToolRequest): Promise<BrowserToolResult> } {
  // Each page's console, from the moment it exists, so `console` can say what happened before Claude asked.
  const consoles = new Map<number, ConsoleEntry[]>();
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    const id = contents.id;
    contents.on('console-message', (event: Electron.Event & { level?: unknown; message?: string; lineNumber?: number; sourceId?: string }, ...legacy: unknown[]) => {
      const level = event.level ?? legacy[0];
      const message = event.message ?? (legacy[1] as string | undefined) ?? '';
      const line = event.lineNumber ?? (legacy[2] as number | undefined) ?? null;
      const source = event.sourceId ?? (legacy[3] as string | undefined) ?? null;
      const list = consoles.get(id) ?? [];
      list.push({ level: consoleLevel(level), text: String(message), source: source || null, line: line || null });
      consoles.set(id, list.slice(-CONSOLE_KEEP));
    });
    contents.once('destroyed', () => consoles.delete(id));
  });

  // Each question to a window, answered by its id.
  let nextId = 1;
  const pending = new Map<number, { window: WebContents; resolve(target: BrowserAgentTarget): void }>();
  ipcMain.on(IpcChannel.browserAgentTargetReply, (event, reply: (BrowserAgentTarget & { requestId?: unknown }) | null) => {
    const id = typeof reply?.requestId === 'number' ? reply.requestId : -1;
    const asked = pending.get(id);
    if (!asked || asked.window !== event.sender) return;
    pending.delete(id);
    asked.resolve({ contentsId: typeof reply!.contentsId === 'number' ? reply!.contentsId : null, url: typeof reply!.url === 'string' ? reply!.url : null, ...(typeof reply!.error === 'string' ? { error: reply!.error } : {}) });
  });

  const target = (win: BrowserWindow, sessionId: string, open: string | null, ensure: boolean) =>
    new Promise<BrowserAgentTarget>((resolve) => {
      const requestId = nextId++;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({ contentsId: null, url: null, error: 'The window did not answer' });
      }, TARGET_MS);
      pending.set(requestId, {
        window: win.webContents,
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
      });
      const request: BrowserAgentTargetRequest = { requestId, sessionId, open, ensure };
      win.webContents.send(IpcChannel.browserAgentTarget, request);
    });

  /** The page, only when it is one of this window's browser pages. */
  const pageOf = (win: BrowserWindow, contentsId: number | null): WebContents | null => {
    const page = contentsId === null ? null : webContents.fromId(contentsId);
    if (!page || page.isDestroyed() || page.getType() !== 'webview' || page.hostWebContents !== win.webContents) return null;
    return page.session === session.fromPartition(WEB_PREVIEW_PARTITION) ? page : null;
  };

  /** Waits until the page stops loading, once it has started on something new or a moment passed. */
  const settled = async (page: WebContents, before: string | null) => {
    const start = Date.now();
    while (Date.now() - start < LOAD_MS && !page.isDestroyed()) {
      const moved = page.getURL() !== before || Date.now() - start > 1_500;
      if (moved && !page.isLoading()) return;
      await wait(100);
    }
  };

  const describe = (page: WebContents) => `${page.getTitle() || 'Untitled'} (${page.getURL()})`;

  const run = async (request: BrowserToolRequest): Promise<BrowserToolResult> => {
    if (!deps.enabled()) return fail('Claude can’t use the browser: it is off in Seshboard (Settings › General › Browser).');
    const win = deps.windowFor(request.sessionId);
    if (!win || win.isDestroyed()) return fail('No Seshboard window is open for this session.');
    const { tool, args } = request;

    if (tool === 'where') {
      const where = await target(win, request.sessionId, null, false);
      return { text: '', url: where.url };
    }

    if (tool === 'open') {
      const url = String(args.url ?? '');
      if (!siteOf(url)) return fail(`Only http and https addresses open in the browser, not “${url}”.`);
      const opened = await target(win, request.sessionId, url, true);
      if (opened.error) return fail(opened.error);
      const page = pageOf(win, opened.contentsId);
      if (!page) return fail('The page did not open. Is the browser allowed in Settings › General?');
      await settled(page, null);
      return { text: `Opened ${describe(page)}. Use browser_snapshot to read it.`, url: page.getURL() };
    }

    const found = await target(win, request.sessionId, null, true);
    if (found.error) return fail(found.error);
    const page = pageOf(win, found.contentsId);
    if (!page) return fail('No page is open in this session’s browser. Use browser_open first.');

    switch (tool) {
      case 'snapshot': {
        const snapshot = (await page.executeJavaScript(SNAPSHOT_SCRIPT, true)) as { title: string; url: string; lines: string[]; truncated: boolean };
        return { text: snapshotText(snapshot), url: page.getURL() };
      }
      case 'click': {
        const ref = String(args.ref ?? '');
        const spot = (await page.executeJavaScript(locateScript(ref), true)) as { x: number; y: number; name: string; covered: boolean } | null;
        if (!spot) return fail(`No element ${ref} on the page now. Take a new browser_snapshot.`);
        const before = page.getURL();
        // Input events are in the page's own pixels, which its zoom scales.
        const zoom = page.getZoomFactor();
        const x = Math.round(spot.x * zoom);
        const y = Math.round(spot.y * zoom);
        page.sendInputEvent({ type: 'mouseMove', x, y });
        page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        page.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await wait(150);
        await settled(page, before);
        return { text: `Clicked “${spot.name}”${spot.covered ? ' (something else was on top of it, and took the click)' : ''}. Now at ${describe(page)}.`, url: page.getURL() };
      }
      case 'type': {
        const ref = String(args.ref ?? '');
        const text = String(args.text ?? '');
        if (!(await page.executeJavaScript(focusScript(ref), true))) return fail(`No element ${ref} on the page now. Take a new browser_snapshot.`);
        const before = page.getURL();
        if (text) await page.insertText(text);
        else for (const event of keyEvents('Backspace')!) page.sendInputEvent(event);
        if (args.submit === true) for (const event of keyEvents('Enter')!) page.sendInputEvent(event);
        await wait(100);
        if (args.submit === true) await settled(page, before);
        return { text: `Typed into ${ref}${args.submit === true ? ' and pressed Enter' : ''}. Now at ${describe(page)}.`, url: page.getURL() };
      }
      case 'press': {
        const events = keyEvents(String(args.key ?? ''));
        if (!events) return fail(`“${String(args.key)}” is not a key the browser tools know.`);
        const before = page.getURL();
        for (const event of events) page.sendInputEvent(event);
        await wait(100);
        await settled(page, before);
        return { text: `Pressed ${String(args.key)}. Now at ${describe(page)}.`, url: page.getURL() };
      }
      case 'screenshot': {
        let image = await page.capturePage();
        if (image.isEmpty()) return fail('The page is not drawn right now. Use browser_open to show it, then try again.');
        if (image.getSize().width > SHOT_WIDTH) image = image.resize({ width: SHOT_WIDTH });
        return { text: `A picture of ${describe(page)}.`, image: { data: image.toJPEG(80).toString('base64'), mimeType: 'image/jpeg' }, url: page.getURL() };
      }
      case 'console':
        return { text: consoleText(consoles.get(page.id) ?? []), url: page.getURL() };
    }
  };

  return {
    run: (request) =>
      run(request).catch((error: Error) => fail(`The browser could not do that: ${error.message}`)),
  };
}
