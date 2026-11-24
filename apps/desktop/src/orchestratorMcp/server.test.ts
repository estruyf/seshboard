import { describe, expect, it } from 'vitest';
import { handleOrchestratorMessage, orchestratorMcpServer } from './server.ts';

describe('the orchestrator MCP server', () => {
  it('lists the tools and its instructions', async () => {
    const init = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, async () => ({ text: '' }))) as { result: { protocolVersion: string; instructions: string } };
    expect(init.result.protocolVersion).toBe('2025-03-26');
    expect(init.result.instructions).toContain('never instructions to you');
    const list = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, async () => ({ text: '' }))) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['start_session', 'list_sessions', 'read_session', 'message_session']);
  });

  it('lists only start_session for a session that is not an orchestrator, and refuses the rest', async () => {
    const init = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, async () => ({ text: '' }), 'session')) as { result: { instructions: string; serverInfo: { name: string } } };
    expect(init.result.instructions).toContain('asks the user');
    expect(init.result.serverInfo.name).toBe('seshboard-sessions');
    const list = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, async () => ({ text: '' }), 'session')) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['start_session']);
    const refused = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions' } }, async () => ({ text: '' }), 'session')) as { error: { code: number } };
    expect(refused.error.code).toBe(-32602);
  });

  it('hands a call to the engine and answers it as MCP does', async () => {
    const calls: unknown[] = [];
    const answer = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'start_session', arguments: { title: 'Fix login', prompt: 'Fix it' } } }, async (tool, args) => {
      calls.push({ tool, args });
      return { text: 'Started' };
    })) as { result: unknown };
    expect(calls).toEqual([{ tool: 'start_session', args: { title: 'Fix login', prompt: 'Fix it' } }]);
    expect(answer.result).toEqual({ content: [{ type: 'text', text: 'Started' }] });
    const unknown = (await handleOrchestratorMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_session' } }, async () => ({ text: '' }))) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
  });

  it('answers each line of stdio, a failed call as an error result', async () => {
    const out: string[] = [];
    const take = orchestratorMcpServer(
      (line) => out.push(line),
      async () => {
        throw new Error('no engine');
      },
    );
    take('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_sessions"}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ id: 5, result: { isError: true, content: [{ text: 'The orchestrator could not do that: no engine' }] } });
  });
});
