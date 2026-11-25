import { describe, expect, it } from 'vitest';
import { githubPage, startFromPageLabel } from './sitePages.ts';

describe('githubPage', () => {
  it('reads a pull request on any of its tabs', () => {
    expect(githubPage('https://github.com/estruyf/seshboard/pull/151')).toEqual({ repo: 'estruyf/seshboard', type: 'pr', number: 151 });
    expect(githubPage('https://github.com/estruyf/seshboard/pull/151/files?w=1#diff-abc')).toEqual({ repo: 'estruyf/seshboard', type: 'pr', number: 151 });
    expect(githubPage('https://GitHub.com/acme/pay.ments/pull/7/commits/')).toEqual({ repo: 'acme/pay.ments', type: 'pr', number: 7 });
  });

  it('reads an issue', () => {
    expect(githubPage('https://github.com/acme/payments/issues/32#issuecomment-1')).toEqual({ repo: 'acme/payments', type: 'issue', number: 32 });
  });

  it('ignores every other page', () => {
    for (const url of [
      'https://github.com/acme/payments',
      'https://github.com/acme/payments/pulls',
      'https://github.com/acme/payments/issues',
      'https://github.com/acme/payments/pull/0',
      'https://github.com/acme/payments/pull/abc',
      'https://github.com/orgs/acme/issues/3',
      'http://github.com/acme/payments/pull/1',
      'https://github.com:8443/acme/payments/pull/1',
      'https://gist.github.com/acme/payments/pull/1',
      'https://github.com.evil.example/acme/payments/pull/1',
      'https://example.com/acme/payments/pull/1',
      'not a url',
      '',
    ]) {
      expect(githubPage(url), url).toBeNull();
    }
  });

  it('labels the page', () => {
    expect(startFromPageLabel({ repo: 'a/b', type: 'pr', number: 151 })).toBe('Start session from pull request #151');
    expect(startFromPageLabel({ repo: 'a/b', type: 'issue', number: 32 })).toBe('Start session from issue #32');
  });
});
