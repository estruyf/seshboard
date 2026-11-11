import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, session, webContents, type WebContents } from 'electron';
import { IpcChannel, type WebPreviewEvent, type WebPreviewKeys } from '@seshboard/protocol/bridge';
import { localPreviewUrl, webPageUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, cookieOfSite, faviconCap, iconTooLarge, keyForWindow, pageMenuEntries, pagePermissionAllowed, popupTarget, previewKeyAction, previewNavigation, webviewAllowed } from './webPreviewRules.ts';

/**
 * Pages whose keys go to their window (`keysToWindow`): the window's document took the focus from them, which Chromium
 * doesn't count as the keyboard leaving the page. Their contents ids.
 */
const keysToWindow = new Set<number>();

/** What the guards need from the app. */
export interface WebPreviewGuardDeps {
  /** Opens an address outside the app: an outside page in the browser, an app's link with the system (a smoke run records it instead). */
  openExternal(url: string): void;
  /** Settings › General › Enable browser: any web page and tabs. Read on every check, so a change applies at once. */
  browser(): boolean;
  /** Settings › General › New sessions › Allow browser previews: a session's dev server beside the conversation. */
  preview(): boolean;
  /** Ask before a page opens another app (`slack:`, `vscode:`): off in a smoke run, where nobody answers. */
  askFirst: boolean;
}

/**
 * The web preview's `<webview>` (a session's dev server beside the conversation, or with the browser on any web
 * page, in tabs), checked here: one attaches only in its own partition, on an allowed address, sandboxed and without a
 * preload or Node; its page stays on allowed addresses (`previewNavigation`); a new window it asks for becomes a tab
 * or goes to the browser (`popupTarget`), never a window; its permission requests and downloads are refused; and the
 * app's shortcuts typed in it reach the app. Call once, before the first window.
 */
export function installWebPreviewGuards(deps: WebPreviewGuardDeps): void {
  const previewSession = session.fromPartition(WEB_PREVIEW_PARTITION);
  // A few harmless ones are allowed (`pagePermissionAllowed`); the check answers as the request does.
  previewSession.setPermissionRequestHandler((_contents, permission, callback) => callback(pagePermissionAllowed(permission)));
  previewSession.setPermissionCheckHandler((_contents, permission) => pagePermissionAllowed(permission));
  previewSession.on('will-download', (event, item, contents) => {
    event.preventDefault();
    // With the browser on, the page says why nothing happened, and offers the browser instead.
    const host = contents?.hostWebContents;
    if (!deps.browser() || !host || host.isDestroyed()) return;
    const url = webPageUrl(item.getURL()) ?? webPageUrl(contents.getURL()) ?? '';
    send(host, { kind: 'download-refused', contentsId: contents.id, url });
  });
  // A dev server's self-signed certificate on this computer is fine; anywhere else Chromium's verdict stands (-3).
  previewSession.setCertificateVerifyProc((request, callback) => callback(request.errorCode !== 0 && acceptsLocalCertificate(request.hostname) ? 0 : -3));

  // A page's keys go to its window (the palette took the focus from it), or, with null, every page of that window's are its own again.
  ipcMain.on(IpcChannel.webPreviewKeysToWindow, (event, contentsId: unknown) => {
    if (event.sender.getType() !== 'window') return;
    if (typeof contentsId !== 'number') {
      for (const id of keysToWindow) if (webContents.fromId(id)?.hostWebContents === event.sender || !webContents.fromId(id)) keysToWindow.delete(id);
      return;
    }
    const guest = webContents.fromId(contentsId);
    if (!guest || guest.getType() !== 'webview' || guest.hostWebContents !== event.sender) return;
    // Not `event.sender.focus()` (T3 Code calls it before a command that moves focus): here the focus has moved
    // already, and that call gives the keyboard and the document's focus back to the page.
    keysToWindow.add(contentsId);
  });

  // Clear data for this site (its cookies, which sign you out, and its storage), or everything the pages keep.
  ipcMain.handle(IpcChannel.webPreviewClearData, async (event, origin: unknown) => {
    if (!deps.browser() || event.sender.getType() !== 'window') return;
    if (typeof origin !== 'string') {
      await previewSession.clearStorageData();
      await previewSession.clearCache();
      await previewSession.clearAuthCache();
      return;
    }
    const page = webPageUrl(origin);
    if (!page) return;
    const { origin: siteOrigin, hostname } = new URL(page);
    await previewSession.clearStorageData({ origin: siteOrigin });
    for (const cookie of await previewSession.cookies.get({})) {
      if (!cookieOfSite(hostname, cookie.domain)) continue;
      const url = `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? hostname).replace(/^\./, '')}${cookie.path ?? '/'}`;
      await previewSession.cookies.remove(url, cookie.name).catch(() => {});
    }
  });

  // ⌘W (Ctrl+W) in the browser's address bar closes the tab, not the window: the window's renderer says when it has focus.
  const addressFocus = new Set<number>();
  ipcMain.on(IpcChannel.webPreviewAddressFocus, (event, focused: unknown) => {
    if (focused === true) addressFocus.add(event.sender.id);
    else addressFocus.delete(event.sender.id);
  });

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'window') return;
    contents.on('will-attach-webview', (event, preferences, params) => {
      if (!webviewAllowed(params, deps.browser(), deps.preview())) {
        event.preventDefault();
        return;
      }
      delete preferences.preload;
      preferences.sandbox = true;
      preferences.contextIsolation = true;
      preferences.nodeIntegration = false;
      preferences.nodeIntegrationInSubFrames = false;
      preferences.webSecurity = true;
      preferences.partition = WEB_PREVIEW_PARTITION;
      // A video's full screen stays in the panel instead of taking the window.
      preferences.disableHtmlFullscreenWindowResize = true;
    });
    contents.on('did-attach-webview', (_event, guest) => guardPage(contents, guest, deps));
    const id = contents.id;
    contents.on('destroyed', () => addressFocus.delete(id));
    // A reload drops the window's state: the address bar that had the focus is gone too.
    contents.on('did-navigate', () => addressFocus.delete(id));
    contents.on('before-input-event', (event, input) => {
      if (!addressFocus.has(id) || input.type !== 'keyDown' || !deps.browser()) return;
      const mod = process.platform === 'darwin' ? input.meta : input.control;
      if (!mod || input.shift || input.alt || input.key.toLowerCase() !== 'w') return;
      event.preventDefault();
      contents.send(IpcChannel.webPreviewKeys, { contentsId: 0, keys: { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift } } satisfies WebPreviewKeys);
    });
  });
}

/** How many of a page's icons are tried before it goes without. */
const FAVICON_TRIES = 4;

/** An icon over this many bytes is sent to the window shrunk: a 40px PNG (main's for PNG and JPEG, the window's for SVG). */
const SMALL_ICON_BYTES = 12 * 1024;

/** The response's body, or null once it passes `cap` bytes: read as it comes, so a page can't make main hold more. */
async function readCapped(response: Response, cap: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length') ?? 0) > cap || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > cap) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
}

/** A page's icon as a small `data:` image, or null when it can't be had, isn't an image or is too large. */
async function faviconData(guest: WebContents, url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await guest.session.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return null;
    const bytes = await readCapped(response, faviconCap(type));
    if (!bytes || bytes.length === 0 || iconTooLarge(bytes, type)) return null;
    if (bytes.length > SMALL_ICON_BYTES && (type === 'image/png' || type === 'image/jpeg')) {
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      return (width >= height ? image.resize({ width: 40, quality: 'good' }) : image.resize({ height: 40, quality: 'good' })).toDataURL();
    }
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

function send(host: WebContents, event: WebPreviewEvent): void {
  if (!host.isDestroyed()) host.send(IpcChannel.webPreviewEvent, event);
}

/** A question about another app is on screen: a page that asks again meanwhile gets no.*/
let asking = false;

/**
 * Opens an app's link (`slack:`, `vscode:`) a page asked for, after asking you: a page's script could otherwise open
 * any app without a click. Cancel is the default, so an Enter typed in the page can't answer it; one question at a time.
 */
async function openAppLink(host: WebContents, url: string, deps: WebPreviewGuardDeps): Promise<void> {
  if (!deps.askFirst) return deps.openExternal(url);
  if (asking) return;
  asking = true;
  try {
    const scheme = url.slice(0, url.indexOf(':'));
    const owner = BrowserWindow.fromWebContents(host);
    const options = {
      type: 'question' as const,
      buttons: ['Open', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Open this ${scheme} link?`,
      detail: `A page in the browser wants to open another app:\n\n${url.length > 300 ? `${url.slice(0, 300)}…` : url}`,
    };
    const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (response === 0) deps.openExternal(url);
  } finally {
    asking = false;
  }
}

/** A page's right-click menu (`pageMenuEntries`), run here against the page, over `owner` (the page's window, or a sign-in window's own). */
function showPageMenu(host: WebContents, guest: WebContents, params: Electron.ContextMenuParams, deps: WebPreviewGuardDeps, owner = BrowserWindow.fromWebContents(host)): void {
  const entries = pageMenuEntries(params, { browser: deps.browser(), back: guest.navigationHistory.canGoBack(), forward: guest.navigationHistory.canGoForward() });
  const run = (id: string, word?: string) => {
    if (guest.isDestroyed()) return;
    switch (id) {
      case 'spelling':
        return word && guest.replaceMisspelling(word);
      case 'open-link':
        return send(host, { kind: 'popup', contentsId: guest.id, url: webPageUrl(params.linkURL)! });
      case 'copy-link':
        return clipboard.writeText(params.linkURL);
      case 'copy-email':
        return clipboard.writeText(params.linkURL.replace(/^mailto:/i, ''));
      case 'copy-image':
        return guest.copyImageAt(params.x, params.y);
      case 'copy-image-address':
        return clipboard.writeText(params.srcURL);
      case 'cut':
        return guest.cut();
      case 'copy':
        return guest.copy();
      case 'paste':
        return guest.paste();
      case 'select-all':
        return guest.selectAll();
      case 'back':
        return guest.navigationHistory.goBack();
      case 'forward':
        return guest.navigationHistory.goForward();
      case 'reload':
        return guest.reload();
      case 'inspect':
        return guest.inspectElement(params.x, params.y);
    }
  };
  const menu = Menu.buildFromTemplate(
    entries.map((entry) => (entry === 'separator' ? { type: 'separator' as const } : entry.id === 'spelling' ? { label: entry.label, click: () => run('spelling', entry.word) } : { label: entry.label, enabled: entry.enabled, click: () => run(entry.id) })),
  );
  menu.popup(owner ? { window: owner } : {});
}

/** The mouse's back and forward buttons in a page go back and ahead in it: a listener in a world of our own, apart from the page's scripts. */
const MOUSE_NAVIGATION = `addEventListener('mouseup', (event) => {
  if (event.button === 3) { event.preventDefault(); history.back(); }
  else if (event.button === 4) { event.preventDefault(); history.forward(); }
}, true);`;
/** The isolated world `MOUSE_NAVIGATION` runs in. */
const SESHBOARD_WORLD = 1999;

function guardPage(host: WebContents, guest: WebContents, deps: WebPreviewGuardDeps): void {
  // Leaving the page: an outside page opens in the browser, an app's link with the system (after asking), anything else goes nowhere.
  const leave = (url: string) => {
    const where = previewNavigation(url, deps.browser());
    if (where === 'browser') deps.openExternal(url);
    else if (where === 'system') void openAppLink(host, url, deps);
  };
  guest.setWindowOpenHandler(({ url, disposition }) => {
    switch (popupTarget(url, deps.browser(), disposition)) {
      case 'window':
        // A real window, sandboxed, in the page's own session, so a sign-in reaches back to the page that opened it.
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      case 'tab':
        send(host, { kind: 'popup', contentsId: guest.id, url: webPageUrl(url)! });
        break;
      case 'same':
        void guest.loadURL(localPreviewUrl(url)!);
        break;
      case 'browser':
        deps.openExternal(url);
        break;
      case 'system':
        void openAppLink(host, url, deps);
        break;
    }
    return { action: 'deny' };
  });
  // A sign-in window: no windows of its own, and it stays on web pages; an app's link from it asks first too.
  guest.on('did-create-window', (popup) => {
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event, url) => {
      if (previewNavigation(url, deps.browser()) === 'stay') return;
      event.preventDefault();
      leave(url);
    });
    popup.webContents.on('context-menu', (_event, params) => showPageMenu(host, popup.webContents, params, deps, popup));
  });
  guest.on('context-menu', (_event, params) => showPageMenu(host, guest, params, deps));
  // Which tab plays sound, for its speaker mark (and Mute).
  guest.on('audio-state-changed', (event) => send(host, { kind: 'audio', contentsId: guest.id, audible: event.audible }));
  guest.on('dom-ready', () => {
    void guest.executeJavaScriptInIsolatedWorld(SESHBOARD_WORLD, [{ code: MOUSE_NAVIGATION }]).catch(() => {});
  });
  guest.on('will-navigate', (event, url) => {
    if (previewNavigation(url, deps.browser()) === 'stay') return;
    event.preventDefault();
    leave(url);
  });
  // A sign-in that redirects to its provider: with the browser off, the page stays and the provider opens in the browser.
  guest.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || previewNavigation(url, deps.browser()) === 'stay') return;
    event.preventDefault();
    leave(url);
  });
  // The page's icon, for its tab: fetched here in the page's own partition (its cookies, its referrer rules) and handed
  // to the window as a `data:` image, so the app's window never loads anything from the page's site itself.
  // The page's candidates in turn: a site's first one can be broken (a template left unfilled, a 404), and the next works.
  // A newer list stops the older fetch (only the newest icon counts); the same list again fetches nothing.
  let fetching: AbortController | null = null;
  let lastList = '';
  guest.on('page-favicon-updated', (_event, favicons) => {
    if (!deps.browser()) return;
    const urls = [...new Set(favicons.map((icon) => webPageUrl(icon)).filter((icon): icon is string => icon !== null))].slice(0, FAVICON_TRIES);
    const list = urls.join('\n');
    if (list === lastList) return;
    lastList = list;
    fetching?.abort();
    const controller = new AbortController();
    fetching = controller;
    void (async () => {
      for (const url of urls) {
        const data = await faviconData(guest, url, controller.signal);
        if (guest.isDestroyed() || controller.signal.aborted) return;
        if (data) return send(host, { kind: 'favicon', contentsId: guest.id, url: data });
      }
    })();
  });
  // A page that goes elsewhere asks for its icon again, even the same one.
  guest.on('did-navigate', () => {
    lastList = '';
  });
  guest.once('destroyed', () => fetching?.abort());
  guest.once('destroyed', () => keysToWindow.delete(guest.id));
  // A click in the page gives it the keyboard again, whatever the window's document says.
  guest.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type === 'mouseDown') keysToWindow.delete(guest.id);
  });
  guest.on('before-input-event', (event, input) => {
    // The window has the focus: what is typed here goes there, as the keyboard would if Chromium had moved it.
    if (keysToWindow.has(guest.id)) {
      event.preventDefault();
      const key = keyForWindow(input);
      if (!key || host.isDestroyed()) return;
      host.sendInputEvent({ type: key.type, keyCode: key.keyCode, modifiers: key.modifiers });
      if (key.char) host.sendInputEvent({ type: 'char', keyCode: key.char, modifiers: key.modifiers });
      return;
    }
    const action = previewKeyAction(input, process.platform, deps.browser());
    if (!action) return;
    event.preventDefault();
    if (action === 'swallow') return;
    if (action === 'reload') return guest.reload();
    if (action === 'back') return guest.navigationHistory.canGoBack() && guest.navigationHistory.goBack();
    if (action === 'ahead') return guest.navigationHistory.canGoForward() && guest.navigationHistory.goForward();
    if (host.isDestroyed()) return;
    const keys: WebPreviewKeys = {
      contentsId: guest.id,
      keys: { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift },
    };
    host.send(IpcChannel.webPreviewKeys, keys);
  });
}
