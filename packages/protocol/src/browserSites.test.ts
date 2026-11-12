import { describe, expect, it } from 'vitest';
import { browserToolOf, isLocalSite, normaliseSite, siteAllowed, siteLabel, siteOf, withSite } from './browserSites.ts';

describe('browser sites', () => {
  it('reads a page’s site as its origin', () => {
    expect(siteOf('https://contoso.sharepoint.com/sites/dev/_layouts/15/workbench.aspx?debug=true')).toBe('https://contoso.sharepoint.com');
    expect(siteOf('http://localhost:4321/')).toBe('http://localhost:4321');
    expect(siteOf('file:///etc/passwd')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });

  it('counts this computer as local, on any port', () => {
    expect(isLocalSite('http://localhost:5173/')).toBe(true);
    expect(isLocalSite('https://localhost:4321/temp/manifests.js')).toBe(true);
    expect(isLocalSite('http://app.localhost/')).toBe(true);
    expect(isLocalSite('http://127.0.0.1:8080/')).toBe(true);
    expect(isLocalSite('http://[::1]:3000/')).toBe(true);
    expect(isLocalSite('https://localhost.example.com/')).toBe(false);
    expect(isLocalSite('https://contoso.sharepoint.com/')).toBe(false);
  });

  it('allows local pages and the project’s sites, matched by origin', () => {
    const allowed = ['contoso.sharepoint.com'];
    expect(siteAllowed('http://localhost:4321/', [])).toBe(true);
    expect(siteAllowed('https://contoso.sharepoint.com/sites/dev/SitePages/Home.aspx', allowed)).toBe(true);
    expect(siteAllowed('https://contoso-admin.sharepoint.com/', allowed)).toBe(false);
    expect(siteAllowed('http://contoso.sharepoint.com/', allowed)).toBe(false);
    expect(siteAllowed('https://github.com/', allowed)).toBe(false);
  });

  it('writes a typed site as an origin, https by default', () => {
    expect(normaliseSite(' contoso.sharepoint.com ')).toBe('https://contoso.sharepoint.com');
    expect(normaliseSite('https://contoso.sharepoint.com/sites/dev')).toBe('https://contoso.sharepoint.com');
    expect(normaliseSite('http://intranet.local:8080')).toBe('http://intranet.local:8080');
    expect(normaliseSite('')).toBeNull();
    expect(siteLabel('https://contoso.sharepoint.com')).toBe('contoso.sharepoint.com');
  });

  it('adds a site once', () => {
    expect(withSite(['https://a.example'], 'a.example')).toEqual(['https://a.example']);
    expect(withSite(['https://a.example'], 'https://b.example/page')).toEqual(['https://a.example', 'https://b.example']);
  });

  it('knows its tools by Claude Code’s names', () => {
    expect(browserToolOf('mcp__browser__click')).toBe('click');
    expect(browserToolOf('mcp__browser__evaluate')).toBeNull();
    expect(browserToolOf('mcp__visualize__show_widget')).toBeNull();
  });
});
