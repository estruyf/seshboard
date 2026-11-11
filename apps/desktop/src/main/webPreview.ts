import { app, ipcMain, session, type WebContents } from 'electron';
import { IpcChannel, type WebPreviewEvent, type WebPreviewKeys } from '@seshboard/protocol/bridge';
import { localPreviewUrl, webPageUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, popupTarget, previewKeyAction, previewNavigation, webviewAllowed } from './webPreviewRules.ts';

/** What the guards need from the app. */
export interface WebPreviewGuardDeps {
  /** Opens an address outside the app: an outside page in the browser, an app's link with the system (a smoke run records it instead). */
  openExternal(url: string): void;
  /** Settings › General › Enable browser: any web page and tabs. Read on every check, so a change applies at once. */
  browser(): boolean;
  /** Settings › General › New sessions › Allow browser previews: a session's dev server beside the conversation. */
  preview(): boolean;
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
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  previewSession.setPermissionCheckHandler(() => false);
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
    contents.on('before-input-event', (event, input) => {
      if (!addressFocus.has(id) || input.type !== 'keyDown' || !deps.browser()) return;
      const mod = process.platform === 'darwin' ? input.meta : input.control;
      if (!mod || input.shift || input.alt || input.key.toLowerCase() !== 'w') return;
      event.preventDefault();
      contents.send(IpcChannel.webPreviewKeys, { contentsId: 0, keys: { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift } } satisfies WebPreviewKeys);
    });
  });
}

/** A favicon larger than this is not one: it is left out. */
const FAVICON_MAX_BYTES = 256 * 1024;

/** A page's icon as a `data:` image, or null when it can't be had or isn't an image. */
async function faviconData(guest: WebContents, url: string): Promise<string | null> {
  try {
    const response = await guest.session.fetch(url, { signal: AbortSignal.timeout(5_000) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > FAVICON_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

function send(host: WebContents, event: WebPreviewEvent): void {
  if (!host.isDestroyed()) host.send(IpcChannel.webPreviewEvent, event);
}

function guardPage(host: WebContents, guest: WebContents, deps: WebPreviewGuardDeps): void {
  // Leaving the page: an outside page opens in the browser, an app's link with the system, anything else goes nowhere.
  const leave = (url: string) => {
    const where = previewNavigation(url, deps.browser());
    if (where === 'browser' || where === 'system') deps.openExternal(url);
  };
  guest.setWindowOpenHandler(({ url }) => {
    switch (popupTarget(url, deps.browser())) {
      case 'tab':
        send(host, { kind: 'popup', contentsId: guest.id, url: webPageUrl(url)! });
        break;
      case 'same':
        void guest.loadURL(localPreviewUrl(url)!);
        break;
      case 'browser':
      case 'system':
        deps.openExternal(url);
        break;
    }
    return { action: 'deny' };
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
  guest.on('page-favicon-updated', (_event, favicons) => {
    if (!deps.browser()) return;
    const url = favicons.map((icon) => webPageUrl(icon)).find((icon): icon is string => icon !== null);
    if (url) void faviconData(guest, url).then((data) => data && send(host, { kind: 'favicon', contentsId: guest.id, url: data }));
  });
  guest.on('before-input-event', (event, input) => {
    const action = previewKeyAction(input, process.platform, deps.browser());
    if (!action) return;
    event.preventDefault();
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
