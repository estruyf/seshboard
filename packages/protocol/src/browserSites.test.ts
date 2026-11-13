import { describe, expect, it } from 'vitest';
import { browserToolOf, isLocalSite, normaliseSite, siteAllowed, siteLabel, siteOf, toCallToolResult, withSite } from './browserSites.ts';

describe('browser sites', () => {
  it('reads a page’s site as its origin', () => {
    expect(siteOf('https://app.example.com/dashboard?debug=true')).toBe('https://app.example.com');
    expect(siteOf('http://localhost:4321/')).toBe('http://localhost:4321');
    expect(siteOf('file:///etc/passwd')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });

  it('counts this computer as local, on any port', () => {
    expect(isLocalSite('http://localhost:5173/')).toBe(true);
    expect(isLocalSite('https://localhost:4321/assets/app.js')).toBe(true);
    expect(isLocalSite('http://app.localhost/')).toBe(true);
    expect(isLocalSite('http://127.0.0.1:8080/')).toBe(true);
    expect(isLocalSite('http://[::1]:3000/')).toBe(true);
    expect(isLocalSite('https://localhost.example.com/')).toBe(false);
    expect(isLocalSite('https://app.example.com/')).toBe(false);
  });

  it('allows local pages and the project’s sites, matched by origin', () => {
    const allowed = ['app.example.com'];
    expect(siteAllowed('http://localhost:4321/', [])).toBe(true);
    expect(siteAllowed('https://app.example.com/settings', allowed)).toBe(true);
    expect(siteAllowed('https://admin.example.com/', allowed)).toBe(false);
    expect(siteAllowed('http://app.example.com/', allowed)).toBe(false);
    expect(siteAllowed('https://github.com/', allowed)).toBe(false);
  });

  it('writes a typed site as an origin, https by default', () => {
    expect(normaliseSite(' app.example.com ')).toBe('https://app.example.com');
    expect(normaliseSite('https://app.example.com/dashboard')).toBe('https://app.example.com');
    expect(normaliseSite('http://intranet.local:8080')).toBe('http://intranet.local:8080');
    expect(normaliseSite('')).toBeNull();
    expect(siteLabel('https://app.example.com')).toBe('app.example.com');
  });

  it('adds a site once', () => {
    expect(withSite(['https://a.example'], 'a.example')).toEqual(['https://a.example']);
    expect(withSite(['https://a.example'], 'https://b.example/page')).toEqual(['https://a.example', 'https://b.example']);
  });

  it('answers a call as MCP does, with a picture and an error flag', () => {
    expect(toCallToolResult({ text: 'Opened' })).toEqual({ content: [{ type: 'text', text: 'Opened' }] });
    expect(toCallToolResult({ text: 'A picture', image: { data: 'AAAA', mimeType: 'image/jpeg' } }).content[1]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    expect(toCallToolResult({ text: 'No element e9', error: true })).toMatchObject({ isError: true });
  });

  it('knows its tools by Claude Code’s names', () => {
    expect(browserToolOf('mcp__browser__click')).toBe('click');
    expect(browserToolOf('mcp__browser__evaluate')).toBeNull();
    expect(browserToolOf('mcp__visualize__show_widget')).toBeNull();
  });
});
