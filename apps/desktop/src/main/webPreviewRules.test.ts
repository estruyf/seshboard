import { describe, expect, it } from 'vitest';
import { WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, cookieOfSite, faviconCap, FAVICON_MAX_SIDE, iconTooLarge, keyForWindow, popupTarget, previewKeyAction, previewNavigation, webviewAllowed, type PreviewKeyInput } from './webPreviewRules.ts';

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
