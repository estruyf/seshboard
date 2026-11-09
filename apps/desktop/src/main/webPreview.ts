import { app, session, type WebContents } from 'electron';
import { IpcChannel, type WebPreviewKeys } from '@seshboard/protocol/bridge';
import { localPreviewUrl, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, previewKeyAction, previewNavigation, webviewAllowed } from './webPreviewRules.ts';

/**
 * The web preview's `<webview>` (a session's dev server beside the conversation), checked here: one attaches only in
 * its own partition, on a local address, sandboxed and without a preload or Node; its page stays on local addresses
 * (anything else opens in the browser); its permission requests and downloads are refused; and the app's shortcuts
 * typed in it reach the app. Call once, before the first window. `openExternal` opens an outside address in the
 * browser (a smoke run records it instead).
 */
export function installWebPreviewGuards(openExternal: (url: string) => void): void {
  const previewSession = session.fromPartition(WEB_PREVIEW_PARTITION);
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.on('will-download', (event) => event.preventDefault());
  // A dev server's self-signed certificate on this computer is fine; anywhere else Chromium's verdict stands (-3).
  previewSession.setCertificateVerifyProc((request, callback) => callback(request.errorCode !== 0 && acceptsLocalCertificate(request.hostname) ? 0 : -3));

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
      preferences.partition = WEB_PREVIEW_PARTITION;
      // A video's full screen stays in the panel instead of taking the window.
      preferences.disableHtmlFullscreenWindowResize = true;
    });
    // Anything that isn't a web page goes nowhere.
    const leave = (url: string) => previewNavigation(url) === 'browser' && openExternal(url);
    contents.on('did-attach-webview', (_event, guest) => guardPage(contents, guest, leave));
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
