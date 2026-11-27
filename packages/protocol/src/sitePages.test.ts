import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ACTIONS, fillSitePrompt, githubPage, pageMatches, sanitizeSiteActions, siteActionsFor, sitePagesProblem, type SiteAction } from './sitePages.ts';

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

});

describe('pageMatches', () => {
  it('matches the address with * for any text, ignoring the query and # part', () => {
    expect(pageMatches('https://*.sentry.io/issues/*', 'https://acme.sentry.io/issues/42/?project=1#top')).toBe(true);
    expect(pageMatches('https://*.sentry.io/issues/*', 'https://sentry.io/issues/42/')).toBe(false);
    expect(pageMatches('https://example.com/docs/*', 'https://EXAMPLE.com/docs/a/b')).toBe(true);
    expect(pageMatches('https://example.com/docs/*', 'https://example.com/blog/a')).toBe(false);
    expect(pageMatches('https://example.com', 'https://example.com/')).toBe(true);
    expect(pageMatches('https://example.com/a.b', 'https://example.com/aXb')).toBe(false);
  });

  it('reads the query only when the pages name one', () => {
    expect(pageMatches('https://dev.azure.com/*?workitem=*', 'https://dev.azure.com/acme/_boards?workitem=12')).toBe(true);
    expect(pageMatches('https://dev.azure.com/*?workitem=*', 'https://dev.azure.com/acme/_boards')).toBe(false);
  });

  it('never matches pages that are not saved, or addresses that are not web pages', () => {
    expect(pageMatches('example.com/*', 'https://example.com/a')).toBe(false);
    expect(pageMatches('https://*', 'file:///etc/passwd')).toBe(false);
  });
});

describe('sitePagesProblem', () => {
  it('asks for an address with a site', () => {
    expect(sitePagesProblem('https://*.example.com/*')).toBeNull();
    expect(sitePagesProblem('')).toContain('Name the pages');
    expect(sitePagesProblem('example.com/*')).toContain('https://');
    expect(sitePagesProblem('https://*/x')).toContain('site');
    expect(sitePagesProblem('https://a.com/x y')).toContain('spaces');
  });
});

describe('siteActionsFor', () => {
  const sentry: SiteAction = { id: 'site-1', name: 'Investigate', pages: 'https://*.sentry.io/issues/*', folder: '/work/pay', prompt: 'Look at {url}', enabled: true };
  it('offers the built-in actions on GitHub, and yours on their pages, when they are on', () => {
    const actions = [...DEFAULT_SITE_ACTIONS, sentry];
    expect(siteActionsFor('https://github.com/a/b/pull/1', actions).map((a) => a.id)).toEqual(['github-pr']);
    expect(siteActionsFor('https://github.com/a/b/issues/1', actions).map((a) => a.id)).toEqual(['github-issue']);
    expect(siteActionsFor('https://acme.sentry.io/issues/9/', actions).map((a) => a.id)).toEqual(['site-1']);
    expect(siteActionsFor('https://github.com/a/b/pull/1', [{ ...DEFAULT_SITE_ACTIONS[0]!, enabled: false }])).toEqual([]);
    expect(siteActionsFor('https://example.com/', actions)).toEqual([]);
  });
});

describe('fillSitePrompt', () => {
  it('fills in the words and drops hidden characters', () => {
    expect(fillSitePrompt('Review {repo}#{number}: {title}\n{url}', { url: 'https://github.com/a/b/pull/1', title: 'Fix\u200b it', selection: '', repo: 'a/b', number: '1' })).toBe('Review a/b#1: Fix it\nhttps://github.com/a/b/pull/1');
    expect(fillSitePrompt('{selection} {unknown}', { url: '', title: '', selection: '  quoted\r\ntext ' })).toBe('quoted\ntext  {unknown}');
    expect(fillSitePrompt('{repo}', { url: '', title: '', selection: '' })).toBe('');
  });
});

describe('sanitizeSiteActions', () => {
  it('keeps the built-in ones once, first if they were missing, and drops broken ones', () => {
    expect(sanitizeSiteActions(undefined)).toEqual(DEFAULT_SITE_ACTIONS);
    const saved = sanitizeSiteActions([
      { id: 'site-1', name: 'Investigate', pages: 'https://*.sentry.io/issues/*', folder: '/work/pay', prompt: 'Look', enabled: false },
      { id: 'github-pr', name: '', pages: 'https://evil.example/*', folder: '/x', prompt: 'Review it', enabled: false },
      { id: 'site-1', name: 'Twice', pages: 'https://a.com/*' },
      { id: 'site-2', name: 'No pages', pages: 'nope' },
      { id: 'Bad Id', name: 'x', pages: 'https://a.com/*' },
      null,
    ]);
    expect(saved.map((a) => a.id)).toEqual(['github-issue', 'site-1', 'github-pr']);
    expect(saved[2]).toEqual({ id: 'github-pr', name: 'Start session from this pull request', pages: '', folder: null, prompt: 'Review it', enabled: false });
    expect(saved[1]).toMatchObject({ folder: '/work/pay', enabled: false });
  });
});
