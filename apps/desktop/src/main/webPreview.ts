import { app, session, type WebContents } from 'electron';
import { IpcChannel, type WebPreviewKeys } from '@seshboard/protocol/bridge';
import { BROWSER_PARTITION, browserNavigation, browserPageUrl, localPreviewUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, previewKeyAction, previewNavigation, webviewAllowed } from './webPreviewRules.ts';

/**
 * The web preview's `<webview>` (a session's dev server beside the conversation), checked here: one attaches only in
 * its own partition, on a local address, sandboxed and without a preload or Node; its page stays on local addresses
 * (anything else opens in the browser); its permission requests and downloads are refused; and the app's shortcuts
 * typed in it reach the app. The browser view's `<webview>` gets the same treatment in a partition of its own, where
 * any web address may load. Call once, before the first window. `openExternal` opens an outside address in the
 * browser (a smoke run records it instead).
 */
export function installWebPreviewGuards(openExternal: (url: string) => void): void {
  const previewSession = session.fromPartition(WEB_PREVIEW_PARTITION);
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.on('will-download', (event) => event.preventDefault());
  // A dev server's self-signed certificate on this computer is fine; anywhere else Chromium's verdict stands (-3).
  previewSession.setCertificateVerifyProc((request, callback) => callback(request.errorCode !== 0 && acceptsLocalCertificate(request.hostname) ? 0 : -3));
  // The browser keeps Chromium's verdict on certificates. Its pages may copy to the clipboard (a copy button on GitHub)
  // and nothing else; downloads wait for a later version.
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  browserSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  browserSession.on('will-download', (event) => event.preventDefault());

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'window') return;
    contents.on('will-attach-webview', (event, preferences, params) => {
      if (!webviewAllowed(params)) {
        event.preventDefault();
        return;
      }
      delete preferences.preload;
      preferences.sandbox = true;
      preferences.contextIsolation = true;
      preferences.nodeIntegration = false;
      preferences.nodeIntegrationInSubFrames = false;
      preferences.webSecurity = true;
      // One of the two, as webviewAllowed checked.
      preferences.partition = params.partition;
      // A video's full screen stays in the panel instead of taking the window.
      preferences.disableHtmlFullscreenWindowResize = true;
    });
    // Anything that isn't a web page goes nowhere.
    const leave = (url: string) => previewNavigation(url) === 'browser' && openExternal(url);
    contents.on('did-attach-webview', (_event, guest) => (guest.session === browserSession ? guardBrowserPage(contents, guest, openExternal) : guardPage(contents, guest, leave)));
  });
}

function guardPage(host: WebContents, guest: WebContents, leave: (url: string) => void): void {
  // A new window is never made: a local address opens in the preview itself, any other in the browser.
  guest.setWindowOpenHandler(({ url }) => {
    const local = localPreviewUrl(url);
    if (local) void guest.loadURL(local);
    else leave(url);
    return { action: 'deny' };
  });
  guest.on('will-navigate', (event, url) => {
    if (previewNavigation(url) === 'stay') return;
    event.preventDefault();
    leave(url);
  });
  // A sign-in that redirects to its provider: the page stays, the provider opens in the browser.
  guest.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || previewNavigation(url) === 'stay') return;
    event.preventDefault();
    leave(url);
  });
  forwardKeys(host, guest);
}

/**
 * The browser's page: it goes anywhere on the web. A new window (a link with `target=_blank`) opens in the same page,
 * a mail link in the mail app, and anything else (`file:`, an app's own scheme) goes nowhere.
 */
function guardBrowserPage(host: WebContents, guest: WebContents, openExternal: (url: string) => void): void {
  guest.setWindowOpenHandler(({ url }) => {
    const page = browserPageUrl(url);
    if (page) void guest.loadURL(page);
    else if (browserNavigation(url) === 'external') openExternal(url);
    return { action: 'deny' };
  });
  const keep = (event: { preventDefault(): void }, url: string) => {
    const where = browserNavigation(url);
    if (where === 'stay') return;
    event.preventDefault();
    if (where === 'external') openExternal(url);
  };
  guest.on('will-navigate', keep);
  guest.on('will-redirect', (event, url, _inPlace, isMainFrame) => isMainFrame && keep(event, url));
  forwardKeys(host, guest);
}

/** ⌘R (Ctrl+R) reloads the page; the app's other shortcuts typed in it go to the app (`previewKeyAction`). */
function forwardKeys(host: WebContents, guest: WebContents): void {
  guest.on('before-input-event', (event, input) => {
    const action = previewKeyAction(input, process.platform);
    if (!action) return;
    event.preventDefault();
    if (action === 'reload') return guest.reload();
    if (host.isDestroyed()) return;
    const keys: WebPreviewKeys = {
      contentsId: guest.id,
      keys: { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift },
    };
    host.send(IpcChannel.webPreviewKeys, keys);
  });
}
