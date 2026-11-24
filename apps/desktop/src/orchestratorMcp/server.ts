import { toolsForRole, type OrchestratorRole, type OrchestratorTool, type OrchestratorToolResult } from '@seshboard/protocol/bridge';
import { lineReader } from '../browserMcp/server.ts';

/**
 * Seshboard's `orchestrator` MCP server, as any agent starts it (Claude Code, Copilot, Codex): the tools that start and
 * track other sessions (docs/orchestrator.md). Like the `browser` server it holds no state of its own: each call goes
 * to the engine's bridge (`call`), which knows which session is an orchestrator. `index.ts` runs it over stdio.
 * Every other session starts it too, as its `seshboard` server, with only start_session (`role` 'session').
 */

const SERVER_INFO = { name: 'seshboard-orchestrator', title: 'Orchestrator', version: '1.0.0' };
const SESSION_SERVER_INFO = { name: 'seshboard-sessions', title: 'Seshboard', version: '1.0.0' };
/** The MCP versions it speaks; it answers in the client's when it knows it, else the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Call = (tool: OrchestratorTool, args: Record<string, unknown>) => Promise<OrchestratorToolResult>;
const isId = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const toCallToolResult = (result: OrchestratorToolResult) => ({ content: [{ type: 'text', text: result.text }], ...(result.error ? { isError: true } : {}) });

/** Answers one message; null when it needs no answer (a notification, or a response). */
export async function handleOrchestratorMessage(message: Message, call: Call, role: OrchestratorRole = 'orchestrator'): Promise<object | null> {
  const { tools, specs, instructions } = toolsForRole(role);
  if (!isId(message.id) || typeof message.method !== 'string') return null;
  const id = message.id;
  const params = record(message.params);
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, error: string) => ({ jsonrpc: '2.0', id, error: { code, message: error } });
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: {} }, serverInfo: role === 'session' ? SESSION_SERVER_INFO : SERVER_INFO, instructions });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: specs });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !(tools as readonly string[]).includes(name)) return fail(-32602, `No tool called ${String(name)}`);
      try {
        return ok(toCallToolResult(await call(name as OrchestratorTool, record(params.arguments))));
      } catch (error) {
        return ok(toCallToolResult({ text: `The orchestrator could not do that: ${(error as Error).message}`, error: true }));
      }
    }
    case 'resources/list':
      return ok({ resources: [] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

/** The server over MCP's stdio transport: `write` gets each answer as a line. Calls can overlap; each answers when done. */
export function orchestratorMcpServer(write: (line: string) => void, call: Call, role: OrchestratorRole = 'orchestrator'): (chunk: string) => void {
  return lineReader((line) => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    void handleOrchestratorMessage(message, call, role).then((answer) => answer && write(`${JSON.stringify(answer)}\n`));
  });
}
