import { describe, expect, it } from 'vitest';
import { addressBarUrl, localPreviewUrl, shortUrl } from './webPreview.ts';

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

describe('shortUrl', () => {
  it('drops the scheme and a root slash', () => {
    expect(shortUrl('http://localhost:5173/')).toBe('localhost:5173');
    expect(shortUrl('https://localhost:5173/docs/')).toBe('localhost:5173/docs/');
  });
});
