import { describe, expect, it } from 'vitest';
import { addressBarUrl, browserNavigation, externalSchemeAllowed, localPreviewUrl, shortUrl, webPageUrl } from './webPreview.ts';

describe('localPreviewUrl', () => {
  it('allows this computer over http and https', () => {
    expect(localPreviewUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(localPreviewUrl('https://localhost:8443/app?x=1#top')).toBe('https://localhost:8443/app?x=1#top');
    expect(localPreviewUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
    expect(localPreviewUrl('http://[::1]:4321/')).toBe('http://[::1]:4321/');
    expect(localPreviewUrl('http://app.localhost:3000/')).toBe('http://app.localhost:3000/');
    expect(localPreviewUrl('http://LOCALHOST:3000/')).toBe('http://localhost:3000/');
  });

  it('turns every interface into localhost', () => {
    expect(localPreviewUrl('http://0.0.0.0:8080/')).toBe('http://localhost:8080/');
    expect(localPreviewUrl('http://[::]:8080/a')).toBe('http://localhost:8080/a');
  });

  it('refuses outside hosts, other schemes and credentials', () => {
    expect(localPreviewUrl('https://example.com/')).toBeNull();
    expect(localPreviewUrl('http://localhost.example.com/')).toBeNull();
    expect(localPreviewUrl('http://192.168.1.4:5173/')).toBeNull();
    expect(localPreviewUrl('http://127.0.0.2/')).toBeNull();
    expect(localPreviewUrl('file:///etc/passwd')).toBeNull();
    expect(localPreviewUrl('javascript:alert(1)')).toBeNull();
    expect(localPreviewUrl('ws://localhost:5173/')).toBeNull();
    expect(localPreviewUrl('http://user:pw@localhost:3000/')).toBeNull();
    expect(localPreviewUrl('http://localhost@evil.example/')).toBeNull();
    expect(localPreviewUrl('not a url')).toBeNull();
  });
});

describe('addressBarUrl', () => {
  it('reads a port as localhost', () => {
    expect(addressBarUrl('5173')).toBe('http://localhost:5173/');
    expect(addressBarUrl(':3000/docs')).toBe('http://localhost:3000/docs');
    expect(addressBarUrl('70000')).toBeNull();
  });

  it('adds http to a bare host', () => {
    expect(addressBarUrl(' localhost:3000/a ')).toBe('http://localhost:3000/a');
    expect(addressBarUrl('127.0.0.1:8000')).toBe('http://127.0.0.1:8000/');
    expect(addressBarUrl('https://localhost:8443')).toBe('https://localhost:8443/');
  });

  it('refuses outside addresses and nothing', () => {
    expect(addressBarUrl('example.com')).toBeNull();
    expect(addressBarUrl('https://github.com')).toBeNull();
    expect(addressBarUrl('   ')).toBeNull();
  });
});

describe('addressBarUrl with any host (the browser)', () => {
  const bar = (input: string) => addressBarUrl(input, { anyHost: true });

  it('keeps a port as localhost', () => {
    expect(bar('5173')).toBe('http://localhost:5173/');
    expect(bar(':3000/docs')).toBe('http://localhost:3000/docs');
  });

  it('adds https to a bare host and http to this computer', () => {
    expect(bar('github.com/estruyf/seshboard')).toBe('https://github.com/estruyf/seshboard');
    expect(bar('dev.azure.com')).toBe('https://dev.azure.com/');
    expect(bar('localhost:3000/a')).toBe('http://localhost:3000/a');
    expect(bar('app.localhost:5173')).toBe('http://app.localhost:5173/');
    expect(bar('example.com:8080/x')).toBe('https://example.com:8080/x');
  });

  it('keeps a full web address', () => {
    expect(bar('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(bar('https://github.com')).toBe('https://github.com/');
  });

  it('refuses text that is not an address, other schemes and credentials', () => {
    expect(bar('pull requests')).toBeNull();
    expect(bar('github')).toBeNull();
    expect(bar('file:///etc/passwd')).toBeNull();
    expect(bar('javascript:alert(1)')).toBeNull();
    expect(bar('https://github.com@evil.example/')).toBeNull();
    expect(bar('user:pw@github.com')).toBeNull();
  });
});

describe('webPageUrl and browserNavigation', () => {
  it('keeps http and https to any host', () => {
    expect(webPageUrl('https://github.com/login/oauth')).toBe('https://github.com/login/oauth');
    expect(browserNavigation('http://example.com/')).toBe('stay');
    expect(browserNavigation('https://localhost:8443/')).toBe('stay');
  });

  it('refuses credentials in the address', () => {
    expect(webPageUrl('https://user:pass@github.com/')).toBeNull();
    expect(browserNavigation('https://user:pass@github.com/')).toBe('block');
  });

  it("hands an app's own scheme to the system", () => {
    expect(browserNavigation('vscode://file/x')).toBe('system');
    expect(browserNavigation('slack://open')).toBe('system');
    expect(browserNavigation('mailto:someone@example.com')).toBe('system');
  });

  it('never loads or opens local and script schemes', () => {
    for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'data:text/html,hi', 'about:blank', 'blob:https://x/1', 'chrome://settings', 'view-source:https://x', 'search-ms:query=x', 'ms-msdt:/id', 'not a url']) {
      expect(browserNavigation(url), url).toBe('block');
      expect(externalSchemeAllowed(url), url).toBe(false);
    }
  });
});

describe('shortUrl', () => {
  it('drops the scheme and a root slash', () => {
    expect(shortUrl('http://localhost:5173/')).toBe('localhost:5173');
    expect(shortUrl('https://localhost:5173/docs/')).toBe('localhost:5173/docs/');
  });
});
