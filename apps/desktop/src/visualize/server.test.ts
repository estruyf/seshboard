import { describe, expect, it } from 'vitest';
import { visualGuide } from './guide.ts';
import { handleVisualizeMessage, VISUAL_APP_URI, visualizeServer } from './server.ts';

const ask = (method: string, params: object = {}) => handleVisualizeMessage({ jsonrpc: '2.0', id: 1, method, params }) as { result?: Record<string, unknown>; error?: { code: number } };

describe('visualize server', () => {
  it('starts in the version the client speaks, or its newest', () => {
    expect(ask('initialize', { protocolVersion: '2025-03-26' }).result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'seshboard-visualize' }, capabilities: { tools: {}, resources: {} } });
    expect(ask('initialize', { protocolVersion: '1999-01-01' }).result?.protocolVersion).toBe('2025-06-18');
  });

  it("has Claude's two tools, read-only, with show_widget as an MCP App", () => {
    const tools = ask('tools/list').result?.tools as Array<{ name: string; annotations: { readOnlyHint: boolean }; _meta?: { ui?: { resourceUri?: string } } }>;
    expect(tools.map((t) => t.name)).toEqual(['read_me', 'show_widget']);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(tools[1]?._meta?.ui?.resourceUri).toBe(VISUAL_APP_URI);
  });

  it('gives the guide for the modules asked for, and draws only a visual with code', () => {
    const guide = ask('tools/call', { name: 'read_me', arguments: { modules: ['chart'] } }).result as { content: Array<{ text: string }> };
    expect(guide.content[0]?.text).toContain('## Charts');
    expect(guide.content[0]?.text).not.toContain('## Mockups');
    expect(ask('tools/call', { name: 'show_widget', arguments: { title: 'flow', loading_messages: ['Drawing'], widget_code: '<svg></svg>' } }).result).not.toHaveProperty('isError');
    expect(ask('tools/call', { name: 'show_widget', arguments: { title: 'flow', widget_code: ' ' } }).result).toMatchObject({ isError: true });
    expect(ask('tools/call', { name: 'delete_files' }).error?.code).toBe(-32602);
  });

  it('serves its page as an MCP App with the CDNs it needs, and nothing else', () => {
    const read = ask('resources/read', { uri: VISUAL_APP_URI }).result as { contents: Array<{ mimeType: string; text: string; _meta: { ui: { csp: { resourceDomains: string[] } } } }> };
    const page = read.contents[0]!;
    expect(page.mimeType).toBe('text/html;profile=mcp-app');
    expect(page.text).toContain("request('ui/initialize'");
    expect(page._meta.ui.csp.resourceDomains).toContain('https://cdnjs.cloudflare.com');
    const script = /<script>([\s\S]*)<\/script>/.exec(page.text)?.[1] ?? '';
    expect(() => new Function(script)).not.toThrow();
    expect(ask('resources/read', { uri: 'ui://other' }).error?.code).toBe(-32002);
  });

  it('answers requests, not notifications, line by line over stdio', () => {
    const out: string[] = [];
    const take = visualizeServer((line) => out.push(line));
    take('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,');
    expect(out).toHaveLength(1);
    take('"method":"tools/list"}\nnot json\n');
    expect(out.map((line) => JSON.parse(line).id)).toEqual([1, 2, null]);
    expect(out.every((line) => line.endsWith('\n'))).toBe(true);
  });

  it('has a guide with the core and no module it was not asked for', () => {
    expect(visualGuide([])).toContain('sendPrompt(text)');
    expect(visualGuide(['nonsense'])).toBe(visualGuide([]));
  });
});
