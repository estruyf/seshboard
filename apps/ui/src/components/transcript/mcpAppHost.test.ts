import { describe, expect, it } from 'vitest';
import { createMcpAppHost, mcpAppPage, type McpAppHostContext, type McpAppHostOptions } from './mcpAppHost.ts';
import { mcpAppStyleVariables } from './visuals.ts';

const CONTEXT: McpAppHostContext = {
  theme: 'dark',
  styles: { variables: { '--color-text-primary': '#eee' } },
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  containerDimensions: { maxHeight: 4000 },
  locale: 'en-GB',
  timeZone: 'Europe/Brussels',
  platform: 'desktop',
  toolInfo: { tool: { name: 'forecast' } },
};

function setup(extra: Partial<McpAppHostOptions> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const did: string[] = [];
  const host = createMcpAppHost({
    post: (message) => sent.push(message as Record<string, unknown>),
    context: () => CONTEXT,
    toolInput: { city: 'Ghent' },
    toolResult: { content: [{ type: 'text', text: '18°C' }], structuredContent: { temperature: 18 } },
    callTool: async (name, args) => (did.push(`call:${name}:${JSON.stringify(args)}`), { content: [{ type: 'text', text: 'done' }] }),
    readResource: async (uri) => ({ contents: [{ uri, text: 'x' }] }),
    openLink: (url) => void did.push(`link:${url}`),
    message: (text) => void did.push(`message:${text}`),
    resize: (height) => void did.push(`size:${height}`),
    log: (level) => void did.push(`log:${level}`),
    ...extra,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { host, sent, did, settle };
}

describe('MCP App host', () => {
  it('answers ui/initialize with its context, and sends the input and result once the page is initialized', () => {
    const { host, sent } = setup();
    host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appCapabilities: {} } });
    expect(sent[0]).toMatchObject({ id: 1, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'Seshboard' }, hostContext: { theme: 'dark', displayMode: 'inline' } } });
    // Nothing goes to the page before it says it is initialized.
    host.contextChanged();
    expect(sent).toHaveLength(1);
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(sent.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
    expect(sent[1]).toMatchObject({ params: { arguments: { city: 'Ghent' } } });
    expect(sent[2]).toMatchObject({ params: { structuredContent: { temperature: 18 } } });
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(sent).toHaveLength(3);
    host.contextChanged();
    expect(sent.at(-1)).toMatchObject({ method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } });
  });

  it('sends the result of a call still running once it comes, and only once', () => {
    const { host, sent } = setup({ toolResult: null });
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(sent.map((m) => m.method)).toEqual(['ui/notifications/tool-input']);
    host.setResult({ content: [{ type: 'text', text: 'done' }] });
    host.setResult({ content: [{ type: 'text', text: 'again' }] });
    expect(sent.map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
  });

  it("passes the page's tool calls and reads on, and says when one fails", async () => {
    const { host, sent, did, settle } = setup({ callTool: async (name) => (name === 'broken' ? Promise.reject(new Error('Create item: you said no')) : { content: [] }) });
    host.receive({ jsonrpc: '2.0', id: 'a', method: 'tools/call', params: { name: 'refresh', arguments: { page: 2 } } });
    host.receive({ jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'broken' } });
    host.receive({ jsonrpc: '2.0', id: 'c', method: 'resources/read', params: { uri: 'ui://weather/icons' } });
    host.receive({ jsonrpc: '2.0', id: 'd', method: 'tools/call', params: {} });
    await settle();
    expect(sent.find((m) => m.id === 'a')).toMatchObject({ result: { content: [] } });
    expect(sent.find((m) => m.id === 'b')).toMatchObject({ error: { code: -32000, message: 'Create item: you said no' } });
    expect(sent.find((m) => m.id === 'c')).toMatchObject({ result: { contents: [{ uri: 'ui://weather/icons' }] } });
    expect(sent.find((m) => m.id === 'd')).toMatchObject({ error: { code: -32602 } });
    expect(did).toEqual([]);
  });

  it('opens http(s) links, puts messages in the box, stays inline, and grows to the reported size', () => {
    const { host, sent, did } = setup();
    host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/open-link', params: { url: 'https://example.com/a' } });
    host.receive({ jsonrpc: '2.0', id: 2, method: 'ui/open-link', params: { url: 'file:///etc/passwd' } });
    host.receive({ jsonrpc: '2.0', id: 3, method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'Show next week' } } });
    host.receive({ jsonrpc: '2.0', id: 4, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: 'One' }, { type: 'text', text: 'Two' }] } });
    host.receive({ jsonrpc: '2.0', id: 5, method: 'ui/message', params: { content: { type: 'image' } } });
    host.receive({ jsonrpc: '2.0', id: 6, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } });
    host.receive({ jsonrpc: '2.0', id: 7, method: 'something/else' });
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 600, height: 312.4 } });
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 1e9 } });
    expect(did).toEqual(['link:https://example.com/a', 'message:Show next week', 'message:One\n\nTwo', 'size:313', 'size:4000']);
    expect(sent.find((m) => m.id === 2)).toMatchObject({ error: { code: -32602, message: 'Invalid URL' } });
    expect(sent.find((m) => m.id === 5)).toMatchObject({ error: { code: -32602 } });
    expect(sent.find((m) => m.id === 6)).toMatchObject({ result: { mode: 'inline' } });
    expect(sent.find((m) => m.id === 7)).toMatchObject({ error: { code: -32601 } });
  });

  it('ignores what is not JSON-RPC, and asks an initialized page to wrap up before it goes', () => {
    const { host, sent } = setup();
    host.receive({ type: 'ready' });
    host.receive('hello');
    host.receive({ jsonrpc: '1.0', id: 1, method: 'ping' });
    host.teardown();
    expect(sent).toEqual([]);
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    host.teardown();
    expect(sent.at(-1)).toMatchObject({ method: 'ui/resource-teardown' });
  });
});

describe('mcpAppPage', () => {
  it('finds the HTML and the origins it declared', () => {
    const page = mcpAppPage([{ uri: 'ui://w/card', mimeType: 'text/html;profile=mcp-app', text: '<p>hi</p>', _meta: { ui: { csp: { connectDomains: ['https://api.example.com'] }, prefersBorder: true } } }], 'ui://w/card');
    expect(page).toEqual({ html: '<p>hi</p>', csp: { connectDomains: ['https://api.example.com'] }, prefersBorder: true });
  });

  it('reads a base64 page, and refuses what is not HTML', () => {
    expect(mcpAppPage([{ uri: 'ui://w/card', mimeType: 'text/html', blob: btoa('<p>blob</p>') }], 'ui://w/card')?.html).toBe('<p>blob</p>');
    expect(mcpAppPage([{ uri: 'ui://w/card', mimeType: 'application/json', text: '{}' }], 'ui://w/card')).toBeNull();
    expect(mcpAppPage([], 'ui://w/card')).toBeNull();
  });
});

describe('mcpAppStyleVariables', () => {
  it("maps the theme's tokens to the spec's names, and leaves out what the theme lacks", () => {
    const tokens: Record<string, string> = { '--sb-bg': '#fff', '--sb-text': '#111', '--sb-error': '#d00', '--font-sans': 'Inter' };
    const vars = mcpAppStyleVariables((name) => tokens[name] ?? '');
    expect(vars['--color-background-primary']).toBe('#fff');
    expect(vars['--color-text-danger']).toBe('#d00');
    expect(vars['--color-background-danger']).toBe('color-mix(in srgb, #d00 14%, #fff)');
    expect(vars['--font-text-md-size']).toBe('13.5px');
    expect(vars).not.toHaveProperty('--color-text-secondary');
    expect(vars).not.toHaveProperty('--color-text-info');
  });
});
