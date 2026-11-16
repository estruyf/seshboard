import { app, ipcMain, webContents, type BrowserWindow, type WebContents } from 'electron';
import { IpcChannel, isScriptTool, SCRIPTS_OFF_TEXT, siteOf, type BrowserAgentTarget, type BrowserAgentTargetRequest, type BrowserToolRequest, type BrowserToolResult } from '@seshboard/protocol/bridge';
import { isProfilePartition, browserProfilePartition } from '@seshboard/protocol/client';
import { isBrowserSession } from './webPreview.ts';
import { CONSOLE_KEEP, consoleLevel, consoleText, EVALUATE_MS, evaluateSource, evaluateText, focusScript, keyEvents, locateScript, pagedText, READ_SCRIPT, readText, SNAPSHOT_SCRIPT, snapshotText, type ConsoleEntry, type EvaluateResult } from './browserAgentScripts.ts';
import { bodyText, NetworkLog, networkText } from './browserNetwork.ts';

/*
 * Browser control (docs/browser.md): the engine hands each browser tool call to main, which drives the session's
 * page. The window that shows the session (its pop-out, or the main window) says which page that is and opens it
 * (`BrowserAgentTargetRequest`); main then reads it with a script and clicks and types with input events, as a person
 * would. Which sites a call may touch was decided before it got here, in the engine's permission check.
 */

export interface BrowserAgentDeps {
  /** The window that shows a session: its pop-out, or the main window. */
  windowFor(sessionId: string): BrowserWindow | null;
  /** Settings › General › Allow browser, and Settings › Browser › Allow Seshboard to control the browser. */
  enabled(): boolean;
  /** Settings › Browser › Allow scripts in pages: evaluate and network (the engine checks it too, and asks per site). */
  scripts(): boolean;
}

/** How long a page may take to load before `open` answers anyway. */
const LOAD_MS = 20_000;
/** How long a window may take to say which page it is. */
const TARGET_MS = 8_000;
/** The widest picture `screenshot` sends, so a large window doesn't cost too much of Claude's context. */
const SHOT_WIDTH = 1280;

/** What the protocol may buffer of a page's responses for `network`, so a body can still be read after it arrived. */
const NETWORK_BUFFER = { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024 };

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

  // `evaluate`'s last result on each page, so a long one is read on in parts without running the script again.
  const evaluated = new Map<number, { script: string; url: string; result: EvaluateResult }>();
  // `network`: each page's requests, from the first call on it (the debugger attaches then), until the page goes.
  const networks = new Map<number, { log: NetworkLog; stopped: string | null }>();
  const listen = async (page: WebContents): Promise<{ log: NetworkLog; started: boolean } | { error: string }> => {
    const known = networks.get(page.id);
    if (known && !known.stopped) return { log: known.log, started: false };
    const again = known?.stopped ? ` (it stopped listening before: ${known.stopped})` : '';
    try {
      // Someone else's debugger on the page (the person's developer tools in some versions) would clash: say so.
      if (page.debugger.isAttached()) throw new Error('another debugger is attached to the page');
      page.debugger.attach('1.3');
    } catch (error) {
      return { error: `Seshboard can’t listen to this page’s requests: ${(error as Error).message}${again}. Close the page’s developer tools and try again.` };
    }
    const state = { log: new NetworkLog(), stopped: null as string | null };
    networks.set(page.id, state);
    page.debugger.on('message', (_event, method, params) => state.log.onEvent(method, (params ?? {}) as Record<string, unknown>));
    page.debugger.once('detach', (_event, reason) => {
      state.stopped = reason || 'the debugger was detached';
    });
    if (!known) page.once('destroyed', () => networks.delete(page.id));
    try {
      await page.debugger.sendCommand('Network.enable', NETWORK_BUFFER);
    } catch (error) {
      networks.delete(page.id);
      if (page.debugger.isAttached()) page.debugger.detach();
      return { error: `Seshboard can’t listen to this page’s requests: ${(error as Error).message}.` };
    }
    return { log: state.log, started: true };
  };
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    const id = contents.id;
    contents.once('destroyed', () => {
      evaluated.delete(id);
      networks.delete(id);
    });
  });

  // Each question to a window, answered by its id.
  let nextId = 1;
  const pending = new Map<number, { window: WebContents; resolve(target: BrowserAgentTarget): void }>();
  ipcMain.on(IpcChannel.browserAgentTargetReply, (event, reply: (BrowserAgentTarget & { requestId?: unknown }) | null) => {
    const id = typeof reply?.requestId === 'number' ? reply.requestId : -1;
    const asked = pending.get(id);
    if (!asked || asked.window !== event.sender) return;
    pending.delete(id);
    asked.resolve({
      contentsId: typeof reply!.contentsId === 'number' ? reply!.contentsId : null,
      url: typeof reply!.url === 'string' ? reply!.url : null,
      profileId: typeof reply!.profileId === 'string' ? reply!.profileId : null,
      ...(typeof reply!.error === 'string' ? { error: reply!.error } : {}),
    });
  });

  const target = (win: BrowserWindow, sessionId: string, open: string | null, ensure: boolean, profileId: string | null = null) =>
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
      const request: BrowserAgentTargetRequest = { requestId, sessionId, open, ensure, ...(open ? { profileId } : {}) };
      win.webContents.send(IpcChannel.browserAgentTarget, request);
    });

  /** The page, only when it is one of this window's browser pages, in a browser profile's guarded partition. */
  const pageOf = (win: BrowserWindow, contentsId: number | null): WebContents | null => {
    const page = contentsId === null ? null : webContents.fromId(contentsId);
    if (!page || page.isDestroyed() || page.getType() !== 'webview' || page.hostWebContents !== win.webContents) return null;
    return isBrowserSession(page.session) ? page : null;
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
    if (!deps.enabled()) return fail('Claude can’t use the browser: it is off in Seshboard (Settings › General › Allow browser, and Settings › Browser).');
    const win = deps.windowFor(request.sessionId);
    if (!win || win.isDestroyed()) return fail('No Seshboard window is open for this session.');
    const { tool, args } = request;

    if (tool === 'where') {
      const where = await target(win, request.sessionId, null, false);
      return { text: '', url: where.url, profileId: where.profileId ?? null };
    }

    if (tool === 'open') {
      const url = String(args.url ?? '');
      if (!siteOf(url)) return fail(`Only http and https addresses open in the browser, not “${url}”.`);
      // The browser profile the engine found for the name the agent gave (null: Default); only ever a profile's own id.
      const profileId = typeof args.profileId === 'string' && isProfilePartition(browserProfilePartition(args.profileId)) ? args.profileId : null;
      const profileName = profileId && typeof args.profileName === 'string' ? args.profileName : null;
      const opened = await target(win, request.sessionId, url, true, profileId);
      if (opened.error) return fail(opened.error);
      const page = pageOf(win, opened.contentsId);
      if (!page) return fail('The page did not open. Is the browser allowed in Settings › General?');
      await settled(page, null);
      return { text: `Opened ${describe(page)}${profileName ? ` in the browser profile ${profileName}` : ''}. Use browser_snapshot to read it.`, url: page.getURL() };
    }

    // Off since the session started: the engine refuses too, and asks per site; this is the last word.
    if (isScriptTool(tool) && !deps.scripts()) return fail(SCRIPTS_OFF_TEXT);
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
      case 'read': {
        const read = (await page.executeJavaScript(READ_SCRIPT, true)) as { title: string; url: string; kind: string; text: string };
        return { text: readText(read, args.offset), url: page.getURL() };
      }
      case 'evaluate': {
        const script = String(args.script ?? '');
        if (!script.trim()) return fail('Give a script to run, such as document.title.');
        const url = page.getURL();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        // Reading on: the same script on the same page answers from its last result and doesn't run again.
        const last = evaluated.get(page.id);
        if (offset > 0 && last && last.script === script && last.url === url) {
          const answer = evaluateText(last.result, url, offset);
          return { ...answer, url };
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<EvaluateResult>((resolve) => (timer = setTimeout(() => resolve({ kind: 'timeout', text: '' }), EVALUATE_MS)));
        const ran = page.executeJavaScript(evaluateSource(script), true).then(
          (value) => value as EvaluateResult,
          (error: Error) => ({ kind: 'error' as const, text: error?.message ?? String(error) }),
        );
        const result = await Promise.race([ran, timeout]).finally(() => clearTimeout(timer));
        evaluated.set(page.id, { script, url, result });
        return { ...evaluateText(result, url, offset), url: page.isDestroyed() ? url : page.getURL() };
      }
      case 'network': {
        const listening = await listen(page);
        if ('error' in listening) return fail(listening.error);
        const url = page.getURL();
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
          const text = networkText(listening.log.list(typeof args.filter === 'string' ? args.filter : null), url, typeof args.filter === 'string' ? args.filter : null);
          return { text: listening.started ? `Seshboard started listening to this page’s requests now.\n${text}` : text, url };
        }
        const entry = listening.log.find(id);
        if (!entry) return fail(`No request ${id} on this page. Call network without id for the list.`);
        if (entry.state === 'pending') return fail(`Request ${id} hasn’t finished yet. Try again in a moment.`);
        if (entry.state === 'failed') return fail(`Request ${id} failed (${entry.error}): it has no body.`);
        let body: { body: string; base64Encoded: boolean };
        try {
          body = (await page.debugger.sendCommand('Network.getResponseBody', { requestId: entry.requestId })) as { body: string; base64Encoded: boolean };
        } catch (error) {
          return fail(`The body of ${id} isn’t available (${(error as Error).message}). A redirect has none, and a page that loaded since forgets the ones before: repeat the request and read it again.`);
        }
        const decoded = bodyText(body, entry.mimeType);
        return { text: pagedText(`The response body of ${id}, ${entry.method} ${entry.status ?? ''} ${entry.url}${entry.mimeType ? ` (${entry.mimeType})` : ''}:`, decoded.text, args.offset, 'network', `id ${id} and `), url };
      }
    }
  };

  return {
    run: (request) =>
      run(request).catch((error: Error) => fail(`The browser could not do that: ${error.message}`)),
  };
}
