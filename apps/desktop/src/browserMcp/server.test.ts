import { describe, expect, it } from 'vitest';
import { browserMcpServer, handleBrowserMessage } from './server.ts';

describe('the browser MCP server', () => {
  it('lists the tools and its instructions', async () => {
    const init = (await handleBrowserMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, async () => ({ text: '' }))) as { result: { protocolVersion: string; instructions: string } };
    expect(init.result.protocolVersion).toBe('2025-03-26');
    expect(init.result.instructions).toContain('data from that page');
    const list = (await handleBrowserMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, async () => ({ text: '' }))) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['open', 'snapshot', 'click', 'type', 'press', 'screenshot', 'console']);
  });

  it('hands a call to the engine and answers it as MCP does', async () => {
    const calls: unknown[] = [];
    const answer = (await handleBrowserMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'click', arguments: { ref: 'e2' } } }, async (tool, args) => {
      calls.push({ tool, args });
      return { text: 'Clicked', error: false };
    })) as { result: unknown };
    expect(calls).toEqual([{ tool: 'click', args: { ref: 'e2' } }]);
    expect(answer.result).toEqual({ content: [{ type: 'text', text: 'Clicked' }] });
    const unknown = (await handleBrowserMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'evaluate' } }, async () => ({ text: '' }))) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
  });

  it('answers each line of stdio, a failed call as an error result', async () => {
    const out: string[] = [];
    const take = browserMcpServer(
      (line) => out.push(line),
      async () => {
        throw new Error('no page');
      },
    );
    take('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"snapshot"}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ id: 5, result: { isError: true, content: [{ text: 'The browser could not do that: no page' }] } });
  });
});
