import { describe, expect, it } from 'vitest';
import { BROWSER_PARTITION, WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { acceptsLocalCertificate, previewKeyAction, previewNavigation, webviewAllowed, type PreviewKeyInput } from './webPreviewRules.ts';

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

  it('lets the browser partition attach on any web or blank address', () => {
    expect(webviewAllowed({ partition: BROWSER_PARTITION, src: 'https://github.com/' })).toBe(true);
    expect(webviewAllowed({ partition: BROWSER_PARTITION, src: 'http://localhost:5173/' })).toBe(true);
    expect(webviewAllowed({ partition: BROWSER_PARTITION })).toBe(true);
    expect(webviewAllowed({ partition: BROWSER_PARTITION, src: 'file:///etc/hosts' })).toBe(false);
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
