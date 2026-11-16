import { describe, expect, it } from 'vitest';
import { browserAccess, browserAnswerOf, browserInstructions, browserPromptText, browserToolOf, browserToolsFor, isLocalSite, normaliseSite, siteAllowed, siteLabel, siteOf, toCallToolResult, withSite } from './browserSites.ts';

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
    expect(browserToolOf('mcp__browser__evaluate')).toBe('evaluate');
    expect(browserToolOf('mcp__browser__eval')).toBeNull();
    expect(browserToolOf('mcp__visualize__show_widget')).toBeNull();
  });

  it('offers evaluate and network only with scripts on, and says when to use read', () => {
    expect(browserToolsFor(false)).toEqual(['open', 'snapshot', 'read', 'click', 'type', 'press', 'screenshot', 'console']);
    expect(browserToolsFor(true)).toEqual(expect.arrayContaining(['evaluate', 'network']));
    expect(browserInstructions(false)).toContain('Use read instead of snapshot');
    expect(browserInstructions(false)).not.toContain('evaluate');
    expect(browserInstructions(true)).toContain('ask the user first');
  });
});

describe('the browser tools’ guard', () => {
  const base = { scripts: true, sites: [], scriptSites: [], sessionSites: [], sessionScriptSites: [] };
  it('runs pages on this computer at once, scripts included', () => {
    expect(browserAccess({ ...base, tool: 'click', url: 'http://localhost:5173/' })).toEqual({ allow: true });
    expect(browserAccess({ ...base, tool: 'evaluate', url: 'http://127.0.0.1:8080/' })).toEqual({ allow: true });
    // No web page yet: the call itself says so.
    expect(browserAccess({ ...base, tool: 'snapshot', url: null })).toEqual({ allow: true });
  });

  it('refuses scripts while they are off, wherever the page is', () => {
    expect(browserAccess({ ...base, scripts: false, tool: 'evaluate', url: 'http://localhost:5173/' })).toEqual({ refuse: expect.stringContaining('Settings › Browser › Allow scripts in pages') });
    expect(browserAccess({ ...base, scripts: false, tool: 'network', url: 'https://contoso.sharepoint.com/' })).toMatchObject({ refuse: expect.any(String) });
    expect(browserAccess({ ...base, scripts: false, tool: 'read', url: 'http://localhost:5173/' })).toEqual({ allow: true });
  });

  it('asks for another site on the site card, and for its scripts on their own', () => {
    const url = 'https://contoso.sharepoint.com/sites/dev/_api/web';
    expect(browserAccess({ ...base, tool: 'read', url })).toEqual({ ask: 'site', site: 'https://contoso.sharepoint.com' });
    expect(browserAccess({ ...base, tool: 'evaluate', url })).toEqual({ ask: 'scripts', site: 'https://contoso.sharepoint.com' });
    // Allowing the site doesn't allow scripts there, and the other way round only covers scripts.
    expect(browserAccess({ ...base, sites: ['contoso.sharepoint.com'], tool: 'evaluate', url })).toMatchObject({ ask: 'scripts' });
    expect(browserAccess({ ...base, scriptSites: ['contoso.sharepoint.com'], tool: 'evaluate', url })).toEqual({ allow: true });
    expect(browserAccess({ ...base, scriptSites: ['contoso.sharepoint.com'], tool: 'click', url })).toMatchObject({ ask: 'site' });
  });

  it('counts sites allowed for this session, by origin', () => {
    const url = 'https://contoso.sharepoint.com/sites/dev';
    expect(browserAccess({ ...base, sessionSites: ['https://contoso.sharepoint.com'], tool: 'open', url })).toEqual({ allow: true });
    expect(browserAccess({ ...base, sessionSites: ['https://contoso.sharepoint.com'], tool: 'open', url: 'https://admin.sharepoint.com/' })).toMatchObject({ ask: 'site' });
    expect(browserAccess({ ...base, sessionScriptSites: ['https://contoso.sharepoint.com'], tool: 'network', url })).toEqual({ allow: true });
  });

  it('words the cards, with Always allow only in an added project', () => {
    const ask = { kind: 'scripts' as const, site: 'https://contoso.sharepoint.com', tool: 'evaluate' as const, input: {}, profile: null, project: true };
    expect(browserPromptText('Claude Code', ask)).toEqual({
      title: 'Claude Code wants to run scripts on contoso.sharepoint.com as you',
      description: expect.stringContaining('with your login on that site.'),
      alwaysLabel: 'scripts on contoso.sharepoint.com in this project',
    });
    expect(browserPromptText('Copilot', { ...ask, profile: 'Admin', project: false })).toMatchObject({ description: expect.stringContaining('in the browser profile Admin'), alwaysLabel: null });
    expect(browserPromptText('Codex', { ...ask, kind: 'site' })).toMatchObject({ title: 'Codex wants to use contoso.sharepoint.com in the browser', alwaysLabel: 'contoso.sharepoint.com in this project' });
  });

  it('reads the card’s choice', () => {
    expect(browserAnswerOf({ behavior: 'allow' })).toBe('once');
    expect(browserAnswerOf({ behavior: 'allow', session: true })).toBe('session');
    expect(browserAnswerOf({ behavior: 'allow', always: true, session: true })).toBe('always');
    expect(browserAnswerOf({ behavior: 'deny' })).toBe('deny');
  });
});
