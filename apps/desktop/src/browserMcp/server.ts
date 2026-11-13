import { BROWSER_INSTRUCTIONS, BROWSER_TOOL_SPECS, BROWSER_TOOLS, toCallToolResult, type BrowserTool, type BrowserToolResult } from '@seshboard/protocol/bridge';

/**
 * Seshboard's `browser` MCP server, as any agent starts it (Claude Code, Copilot, Codex): the tools that drive the
 * session's Browser panel. It holds no state of its own: each call goes to the engine's bridge (`call`), which checks
 * the site, asks you when it needs to, and has main drive the page. `index.ts` runs it over stdio.
 */

const SERVER_INFO = { name: 'seshboard-browser', title: 'Browser', version: '1.0.0' };
/** The MCP versions it speaks; it answers in the client's when it knows it, else the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Call = (tool: BrowserTool, args: Record<string, unknown>) => Promise<BrowserToolResult>;
const isId = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Answers one message; null when it needs no answer (a notification, or a response). */
export async function handleBrowserMessage(message: Message, call: Call): Promise<object | null> {
  if (!isId(message.id) || typeof message.method !== 'string') return null;
  const id = message.id;
  const params = record(message.params);
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, error: string) => ({ jsonrpc: '2.0', id, error: { code, message: error } });
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: BROWSER_INSTRUCTIONS });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: BROWSER_TOOL_SPECS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !(BROWSER_TOOLS as readonly string[]).includes(name)) return fail(-32602, `No tool called ${String(name)}`);
      try {
        return ok(toCallToolResult(await call(name as BrowserTool, record(params.arguments))));
      } catch (error) {
        return ok(toCallToolResult({ text: `The browser could not do that: ${(error as Error).message}`, error: true }));
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

/** Newline-delimited JSON: each complete line of `chunk`s, in order. */
export function lineReader(onLine: (line: string) => void): (chunk: string) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) onLine(line);
    }
  };
}

/** The server over MCP's stdio transport: `write` gets each answer as a line. Calls can overlap; each answers when done. */
export function browserMcpServer(write: (line: string) => void, call: Call): (chunk: string) => void {
  return lineReader((line) => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    void handleBrowserMessage(message, call).then((answer) => answer && write(`${JSON.stringify(answer)}\n`));
  });
}
