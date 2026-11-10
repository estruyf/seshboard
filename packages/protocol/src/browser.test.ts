import { describe, expect, it } from 'vitest';
import { browserAddress, browserNavigation, browserPageUrl } from './browser.ts';

describe('browserPageUrl', () => {
  it('allows http and https anywhere', () => {
    expect(browserPageUrl('https://github.com/estruyf/seshboard/pulls')).toBe('https://github.com/estruyf/seshboard/pulls');
    expect(browserPageUrl('http://localhost:5173')).toBe('http://localhost:5173/');
  });

  it('refuses other schemes and credentials', () => {
    expect(browserPageUrl('file:///etc/passwd')).toBeNull();
    expect(browserPageUrl('javascript:alert(1)')).toBeNull();
    expect(browserPageUrl('https://github.com@evil.example/')).toBeNull();
    expect(browserPageUrl('not a url')).toBeNull();
  });
});

describe('browserAddress', () => {
  it('keeps a full address', () => {
    expect(browserAddress(' https://github.com/estruyf ')).toBe('https://github.com/estruyf');
    expect(browserAddress('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  });

  it('adds https to a bare host, http to this computer', () => {
    expect(browserAddress('github.com/estruyf/seshboard')).toBe('https://github.com/estruyf/seshboard');
    expect(browserAddress('docs.anthropic.com')).toBe('https://docs.anthropic.com/');
    expect(browserAddress('localhost:3000/docs')).toBe('http://localhost:3000/docs');
    expect(browserAddress('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
  });

  it('refuses what is not an address', () => {
    expect(browserAddress('')).toBeNull();
    expect(browserAddress('pull requests')).toBeNull();
    expect(browserAddress('github')).toBeNull();
    expect(browserAddress('file:///etc/passwd')).toBeNull();
    expect(browserAddress('javascript:alert(1)')).toBeNull();
  });
});

describe('browserNavigation', () => {
  it('keeps web pages, hands mail to its app and blocks the rest', () => {
    expect(browserNavigation('https://github.com/login')).toBe('stay');
    expect(browserNavigation('mailto:someone@example.com')).toBe('external');
    expect(browserNavigation('file:///etc/passwd')).toBe('block');
    expect(browserNavigation('vscode://file/x')).toBe('block');
  });
});
