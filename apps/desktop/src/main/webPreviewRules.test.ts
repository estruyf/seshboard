import { describe, expect, it, vi } from 'vitest';
import { WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, audibleHold, cookieOfSite, downloadFileName, partitionClearing, faviconCap, FAVICON_MAX_SIDE, iconTooLarge, isAltGrCharacter, isEditingKey, keyForWindow, needsCanvas, pageMenuEntries, pagePermissionAllowed, popupTarget, previewKeyAction, previewNavigation, webviewAllowed, type PreviewKeyInput } from './webPreviewRules.ts';

const key = (k: string, mods: Partial<PreviewKeyInput> = {}): PreviewKeyInput => ({ type: 'keyDown', key: k, meta: false, control: false, alt: false, shift: false, ...mods });

describe('previewKeyAction', () => {
  it('reloads the page on ⌘R and Ctrl+R', () => {
    expect(previewKeyAction(key('r', { meta: true }), 'darwin')).toBe('reload');
    expect(previewKeyAction(key('R', { control: true }), 'win32')).toBe('reload');
  });

  it("hands the app's keys over and keeps editing keys in the page", () => {
    expect(previewKeyAction(key('k', { meta: true }), 'darwin')).toBe('forward');
    expect(previewKeyAction(key('b', { meta: true, shift: true }), 'darwin')).toBe('forward');
    expect(previewKeyAction(key('v', { meta: true }), 'darwin')).toBeNull();
    expect(previewKeyAction(key('z', { meta: true, shift: true }), 'darwin')).toBeNull();
    expect(previewKeyAction(key('c', { control: true }), 'linux')).toBeNull();
  });

  it('leaves plain typing, key-ups and the other platform’s modifier alone', () => {
    expect(previewKeyAction(key('k'), 'darwin')).toBeNull();
    expect(previewKeyAction({ ...key('k', { meta: true }), type: 'keyUp' }, 'darwin')).toBeNull();
    expect(previewKeyAction(key('k', { control: true }), 'darwin')).toBeNull();
    expect(previewKeyAction(key('k', { meta: true }), 'win32')).toBeNull();
    expect(previewKeyAction(key('Meta', { meta: true }), 'darwin')).toBeNull();
  });
});

describe('webviewAllowed', () => {
  it('lets only the preview partition attach, on a local or blank address', () => {
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'http://localhost:5173/' })).toBe(true);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'about:blank' })).toBe(true);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION })).toBe(true);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'https://example.com/' })).toBe(false);
    expect(webviewAllowed({ partition: 'persist:other', src: 'http://localhost:5173/' })).toBe(false);
    expect(webviewAllowed({ src: 'http://localhost:5173/' })).toBe(false);
  });
});

describe('acceptsLocalCertificate', () => {
  it('takes a self-signed certificate only from this computer', () => {
    expect(acceptsLocalCertificate('localhost')).toBe(true);
    expect(acceptsLocalCertificate('app.localhost')).toBe(true);
    expect(acceptsLocalCertificate('127.0.0.1')).toBe(true);
    expect(acceptsLocalCertificate('::1')).toBe(true);
    expect(acceptsLocalCertificate('[::1]')).toBe(true);
    expect(acceptsLocalCertificate('example.com')).toBe(false);
    expect(acceptsLocalCertificate('192.168.1.4')).toBe(false);
  });
});

describe('previewNavigation', () => {
  it('keeps local pages, sends web pages to the browser and blocks the rest', () => {
    expect(previewNavigation('http://localhost:3000/next')).toBe('stay');
    expect(previewNavigation('https://github.com/login')).toBe('browser');
    expect(previewNavigation('file:///etc/hosts')).toBe('block');
    expect(previewNavigation('vscode://file/x')).toBe('block');
  });
});

describe('with the browser on', () => {
  it('lets any web address attach, and nothing else', () => {
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'https://github.com/' }, true)).toBe(true);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'file:///etc/hosts' }, true)).toBe(false);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'https://u:p@github.com/' }, true)).toBe(false);
    expect(webviewAllowed({ partition: 'persist:other', src: 'https://github.com/' }, true)).toBe(false);
  });

  it('keeps web pages, hands app links to the system and blocks the rest', () => {
    expect(previewNavigation('https://github.com/login', true)).toBe('stay');
    expect(previewNavigation('vscode://file/x', true)).toBe('system');
    expect(previewNavigation('file:///etc/hosts', true)).toBe('block');
    expect(previewNavigation('javascript:alert(1)', true)).toBe('block');
    expect(previewNavigation('data:text/html,hi', true)).toBe('block');
    expect(previewNavigation('https://user:pass@github.com/', true)).toBe('block');
  });

  it('turns a new window into a tab, never a window', () => {
    expect(popupTarget('https://github.com/login/oauth/authorize', true)).toBe('tab');
    expect(popupTarget('https://github.com/x', true, 'foreground-tab')).toBe('tab');
    // A sized window.open (a sign-in) stays a window, so window.opener survives.
    expect(popupTarget('https://accounts.google.com/o/oauth2/auth', true, 'new-window')).toBe('window');
    expect(popupTarget('https://accounts.google.com/', false, 'new-window')).toBe('browser');
    expect(popupTarget('slack://open', true)).toBe('system');
    expect(popupTarget('javascript:alert(1)', true)).toBe('none');
  });

  it('goes back and ahead on ⌘[ and ⌘], only with the browser on', () => {
    expect(previewKeyAction(key('[', { meta: true }), 'darwin', true)).toBe('back');
    expect(previewKeyAction(key(']', { control: true }), 'win32', true)).toBe('ahead');
    expect(previewKeyAction(key('[', { meta: true }), 'darwin')).toBe('forward');
    expect(previewKeyAction(key('t', { meta: true }), 'darwin', true)).toBe('forward');
    expect(previewKeyAction(key('w', { meta: true }), 'darwin', true)).toBe('forward');
    expect(previewKeyAction(key('l', { meta: true }), 'darwin', true)).toBe('forward');
  });
});

describe('with previews off', () => {
  it('lets no page attach, unless the browser is on', () => {
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'http://localhost:5173/' }, false, false)).toBe(false);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION }, false, false)).toBe(false);
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'https://github.com/' }, true, false)).toBe(true);
  });
});

describe('with the browser off, the web preview as before', () => {
  it('keeps the old rules', () => {
    expect(previewNavigation('https://github.com/login')).toBe('browser');
    expect(previewNavigation('vscode://file/x')).toBe('block');
    expect(popupTarget('http://localhost:3000/x')).toBe('same');
    expect(popupTarget('https://github.com/')).toBe('browser');
    expect(webviewAllowed({ partition: WEB_PREVIEW_PARTITION, src: 'https://github.com/' })).toBe(false);
  });
});

describe('browser profiles', () => {
  const profile = 'persist:browser-3f2b8c1e-6a4d-4e7b-9c2a-1d5e8f7a6b3c';
  it("lets a page attach in a browser profile's partition with the browser on, and in no other", () => {
    expect(webviewAllowed({ partition: profile, src: 'https://github.com/' }, true)).toBe(true);
    expect(webviewAllowed({ partition: profile }, true)).toBe(true);
    // The web preview alone has no profiles.
    expect(webviewAllowed({ partition: profile, src: 'http://localhost:5173/' }, false, true)).toBe(false);
    for (const partition of ['persist:browser-admin', 'persist:browser-../x', 'persist:main', '', undefined]) expect(webviewAllowed({ partition, src: 'https://github.com/' }, true)).toBe(false);
  });

  it('clears only what Reset ticked', () => {
    expect(partitionClearing({ cookies: true, siteData: false, cache: false })).toEqual({ storages: ['cookies'], authCache: true, cache: false });
    expect(partitionClearing({ cookies: false, siteData: true, cache: false })).toEqual({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'], authCache: false, cache: false });
    expect(partitionClearing({ cookies: false, siteData: false, cache: true })).toEqual({ storages: ['shadercache'], authCache: false, cache: true });
    expect(partitionClearing({ cookies: false, siteData: false, cache: false })).toEqual({ storages: [], authCache: false, cache: false });
  });
});

describe('cookieOfSite', () => {
  it("takes the site's own cookies and those of the domains above it, never a neighbour's", () => {
    expect(cookieOfSite('github.com', '.github.com')).toBe(true);
    expect(cookieOfSite('github.com', 'github.com')).toBe(true);
    expect(cookieOfSite('gist.github.com', '.github.com')).toBe(true);
    expect(cookieOfSite('github.com', 'gist.github.com')).toBe(false);
    expect(cookieOfSite('github.com', 'notgithub.com')).toBe(false);
    expect(cookieOfSite('mygithub.com', '.github.com')).toBe(false);
    expect(cookieOfSite('GitHub.com', '.github.COM')).toBe(true);
    expect(cookieOfSite('github.com', undefined)).toBe(false);
  });
});

describe('favicon limits', () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  };
  const gif = (width: number, height: number) => {
    const bytes = new Uint8Array(10);
    const view = new DataView(bytes.buffer);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    return bytes;
  };

  it('reads an SVG up to 4 MB, a PNG or GIF up to 1 MB, anything else up to 256 KB', () => {
    expect(faviconCap('image/svg+xml')).toBe(4 * 1024 * 1024);
    expect(faviconCap('image/png')).toBe(1024 * 1024);
    expect(faviconCap('image/x-icon')).toBe(256 * 1024);
  });

  it('refuses a PNG or GIF whose header says it is huge, whatever its bytes', () => {
    expect(iconTooLarge(png(32, 32), 'image/png')).toBe(false);
    expect(iconTooLarge(png(20_000, 20_000), 'image/png')).toBe(true);
    expect(iconTooLarge(png(32, FAVICON_MAX_SIDE + 1), 'image/png')).toBe(true);
    expect(iconTooLarge(new Uint8Array(8), 'image/png')).toBe(true);
    expect(iconTooLarge(gif(16, 16), 'image/gif')).toBe(false);
    expect(iconTooLarge(gif(60_000, 16), 'image/gif')).toBe(true);
    expect(iconTooLarge(new Uint8Array(4), 'image/x-icon')).toBe(false);
  });
});

describe('keyForWindow', () => {
  it('sends a typed letter with its character, and the key up without one', () => {
    expect(keyForWindow(key('z'))).toEqual({ type: 'keyDown', keyCode: 'z', char: 'z', modifiers: [] });
    expect(keyForWindow(key('Z', { shift: true }))).toEqual({ type: 'keyDown', keyCode: 'Z', char: 'Z', modifiers: ['shift'] });
    expect(keyForWindow({ ...key('z'), type: 'keyUp' })).toEqual({ type: 'keyUp', keyCode: 'z', char: null, modifiers: [] });
  });

  it("names the keys sendInputEvent knows by another name, and types no character for them or for a shortcut", () => {
    expect(keyForWindow(key('ArrowDown'))).toMatchObject({ keyCode: 'Down', char: null });
    expect(keyForWindow(key('Enter'))).toMatchObject({ keyCode: 'Return', char: null });
    expect(keyForWindow(key('Escape'))).toMatchObject({ keyCode: 'Escape', char: null });
    expect(keyForWindow(key('Backspace'))).toMatchObject({ keyCode: 'Backspace', char: null });
    expect(keyForWindow(key(' '))).toMatchObject({ keyCode: 'Space', char: ' ' });
    expect(keyForWindow(key('k', { meta: true }))).toEqual({ type: 'keyDown', keyCode: 'k', char: null, modifiers: ['meta'] });
  });

  it('passes on nothing for a modifier alone or a key it has no name for', () => {
    expect(keyForWindow(key('Shift', { shift: true }))).toBeNull();
    expect(keyForWindow(key('F13'))).toBeNull();
  });
});

describe('keys in a page, as T3 Code splits them', () => {
  it("keeps the page's editing keys and hands ⇧ shortcuts that aren't editing to the app", () => {
    expect(isEditingKey(key('v', { meta: true, alt: true, shift: true, code: 'KeyV' }), 'darwin')).toBe(true);
    expect(isEditingKey(key('V', { control: true, shift: true }), 'linux')).toBe(true);
    expect(isEditingKey(key('z', { meta: true, shift: true }), 'darwin')).toBe(true);
    expect(isEditingKey(key('z', { control: true, shift: true }), 'win32')).toBe(false);
    expect(isEditingKey(key('y', { control: true }), 'win32')).toBe(true);
    expect(isEditingKey(key('y', { meta: true }), 'darwin')).toBe(false);
    expect(previewKeyAction(key('a', { meta: true, shift: true }), 'darwin')).toBe('forward');
    expect(previewKeyAction(key('c', { meta: true, shift: true }), 'darwin')).toBe('forward');
    expect(previewKeyAction(key('a', { meta: true }), 'darwin')).toBeNull();
  });

  it('leaves AltGr characters, input method keys and held keys to the page, or runs them once', () => {
    expect(isAltGrCharacter(key('@', { control: true, alt: true }), 'win32')).toBe(true);
    expect(isAltGrCharacter(key('Dead', { control: true, alt: true }), 'linux')).toBe(true);
    expect(isAltGrCharacter(key('k', { control: true, alt: true }), 'win32')).toBe(false);
    expect(isAltGrCharacter(key('@', { control: true, alt: true }), 'darwin')).toBe(false);
    expect(previewKeyAction(key('{', { control: true, alt: true }), 'win32')).toBeNull();
    expect(previewKeyAction({ ...key('k', { meta: true }), isComposing: true }, 'darwin')).toBeNull();
    expect(previewKeyAction({ ...key('w', { meta: true }), isAutoRepeat: true }, 'darwin', true)).toBe('swallow');
  });
});

describe('pagePermissionAllowed', () => {
  it("allows a site's copy buttons, fullscreen and pointer lock, and refuses the rest", () => {
    for (const ok of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'loopback-network']) expect(pagePermissionAllowed(ok)).toBe(true);
    for (const no of ['geolocation', 'media', 'notifications', 'clipboard-read', 'openExternal', 'local-fonts']) expect(pagePermissionAllowed(no)).toBe(false);
  });
});

describe('pageMenuEntries', () => {
  const params = { linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, dictionarySuggestions: [], editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true } };
  const ids = (entries: ReturnType<typeof pageMenuEntries>) => entries.map((e) => (e === 'separator' ? '-' : e.id));
  const page = { browser: true, back: true, forward: false, session: false };

  it('offers back, forward and reload on the page itself, then Inspect', () => {
    expect(ids(pageMenuEntries(params, page))).toEqual(['back', 'forward', 'reload', '-', 'inspect']);
    expect(pageMenuEntries(params, page)[1]).toMatchObject({ id: 'forward', enabled: false });
  });

  it("offers the link's actions, a new tab only with the browser on, and copy for a selection", () => {
    expect(ids(pageMenuEntries({ ...params, linkURL: 'https://github.com/x' }, page))).toEqual(['open-link', 'copy-link', '-', 'inspect']);
    expect(ids(pageMenuEntries({ ...params, linkURL: 'https://github.com/x' }, { ...page, browser: false }))).toEqual(['copy-link', '-', 'inspect']);
    expect(ids(pageMenuEntries({ ...params, linkURL: 'mailto:me@example.com' }, page))).toEqual(['copy-email', '-', 'inspect']);
    expect(ids(pageMenuEntries({ ...params, selectionText: 'hello' }, page))).toEqual(['copy', '-', 'inspect']);
  });

  it("offers a session's page the selection and the element for its message", () => {
    const session = { ...page, session: true };
    expect(ids(pageMenuEntries(params, session))).toEqual(['back', 'forward', 'reload', '-', 'add-element', '-', 'inspect']);
    expect(ids(pageMenuEntries({ ...params, selectionText: 'hello' }, session))).toEqual(['copy', '-', 'quote', 'add-element', '-', 'inspect']);
    expect(ids(pageMenuEntries({ ...params, selectionText: '  ' }, session))).toEqual(['back', 'forward', 'reload', '-', 'add-element', '-', 'inspect']);
  });

  it('offers Start session on a GitHub pull request or issue, before the message entries', () => {
    const start = 'Start session from pull request #151';
    expect(ids(pageMenuEntries(params, { ...page, start }))).toEqual(['back', 'forward', 'reload', '-', 'start-session', '-', 'inspect']);
    expect(pageMenuEntries(params, { ...page, start })[4]).toMatchObject({ id: 'start-session', label: start, enabled: true });
    expect(ids(pageMenuEntries({ ...params, selectionText: 'hello' }, { ...page, session: true, start }))).toEqual(['copy', '-', 'start-session', '-', 'quote', 'add-element', '-', 'inspect']);
    expect(ids(pageMenuEntries(params, { ...page, start: null }))).toEqual(['back', 'forward', 'reload', '-', 'inspect']);
  });

  it('offers spelling, then editing in a field, as the field allows', () => {
    const field = { ...params, isEditable: true, dictionarySuggestions: ['hello'], editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } };
    const entries = pageMenuEntries(field, page);
    expect(ids(entries)).toEqual(['spelling', '-', 'cut', 'copy', 'paste', 'select-all', '-', 'inspect']);
    expect(entries[2]).toMatchObject({ id: 'cut', enabled: false });
  });
});

describe('downloadFileName', () => {
  const none = () => false;

  it('keeps the name the page gave', () => {
    expect(downloadFileName('report.pdf', none)).toBe('report.pdf');
  });

  it('numbers the name while a file has it, before the extension', () => {
    const taken = new Set(['report.pdf', 'report (1).pdf']);
    expect(downloadFileName('report.pdf', (name) => taken.has(name))).toBe('report (2).pdf');
    expect(downloadFileName('README', (name) => name === 'README')).toBe('README (1)');
    expect(downloadFileName('.env', (name) => name === 'env')).toBe('env (1)');
  });

  it('keeps only the last part of a path and clears what no system takes', () => {
    expect(downloadFileName('../../etc/passwd', none)).toBe('passwd');
    expect(downloadFileName('C:\\Windows\\a.exe', none)).toBe('a.exe');
    expect(downloadFileName('what?.txt', none)).toBe('what_.txt');
  });

  it('gives a name to a download without one', () => {
    expect(downloadFileName('', none)).toBe('download');
    expect(downloadFileName('..', none)).toBe('download');
  });
});

describe('audibleHold', () => {
  it('keeps the speaker through a short pause and drops it after a long one', () => {
    vi.useFakeTimers();
    try {
      const reports: boolean[] = [];
      const hold = audibleHold((audible) => reports.push(audible), 2000);
      hold.set(true);
      hold.set(false);
      vi.advanceTimersByTime(1500);
      hold.set(true);
      vi.advanceTimersByTime(5000);
      expect(reports).toEqual([true]);
      hold.set(false);
      vi.advanceTimersByTime(2000);
      expect(reports).toEqual([true, false]);
      hold.set(false);
      vi.advanceTimersByTime(5000);
      expect(reports).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports nothing after it is disposed', () => {
    vi.useFakeTimers();
    try {
      const reports: boolean[] = [];
      const hold = audibleHold((audible) => reports.push(audible), 2000);
      hold.set(true);
      hold.set(false);
      hold.dispose();
      vi.advanceTimersByTime(5000);
      expect(reports).toEqual([true]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('needsCanvas', () => {
  it('draws the canvas under text, JSON and XML Chromium shows itself', () => {
    expect(needsCanvas('text/plain')).toBe(true);
    expect(needsCanvas('application/json; charset=utf-8')).toBe(true);
    expect(needsCanvas('application/atom+xml;type=feed;charset=utf-8')).toBe(true);
    expect(needsCanvas('text/xml')).toBe(true);
    expect(needsCanvas('application/ld+json')).toBe(true);
  });

  it('leaves pages and media that draw their own background', () => {
    expect(needsCanvas('text/html')).toBe(false);
    expect(needsCanvas('application/xhtml+xml')).toBe(false);
    expect(needsCanvas('image/svg+xml')).toBe(false);
    expect(needsCanvas('image/png')).toBe(false);
    expect(needsCanvas('video/mp4')).toBe(false);
    expect(needsCanvas('application/pdf')).toBe(false);
  });
});
