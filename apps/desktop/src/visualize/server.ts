import { MCP_APP_MIME_TYPE } from '@seshboard/protocol/client';
import { VISUAL_APP_CSP, visualAppHtml } from '../main/visualFrame.ts';
import { VISUAL_MODULES, visualGuide } from './guide.ts';

/**
 * Seshboard's `visualize` MCP server: the same two tools as the Claude desktop app's (`read_me`, then `show_widget`),
 * so the agent's tool calls read the same in every app, and `show_widget` is an MCP App (`ui://visualize/widget`),
 * so any host that speaks MCP Apps draws it. Seshboard draws the call from its input (`VisualBlock`). Pure: one JSON-RPC
 * message in, the answer out (null for a notification). `index.ts` runs it over stdio.
 */

export const VISUAL_APP_URI = 'ui://visualize/widget';

const SERVER_INFO = { name: 'seshboard-visualize', title: 'Visuals', version: '1.0.0' };

/** The MCP versions it speaks; it answers in the client's when it knows it, else the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'read_me',
    title: 'How to draw visuals',
    description:
      'Returns how to write a visual for show_widget: the frame, the CSS variables and colour classes, SVG rules and examples. Call it once before your first show_widget, and again for another module. It is setup: call it without mentioning it to the user.',
    inputSchema: {
      type: 'object',
      properties: { modules: { type: 'array', items: { type: 'string', enum: [...VISUAL_MODULES] }, description: 'The kinds of visual you are about to make.' } },
      additionalProperties: false,
    },
    annotations: { title: 'How to draw visuals', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'show_widget',
    title: 'Show a visual',
    description:
      "Draws a visual inline in the conversation, where you call it: an SVG diagram, or an HTML widget with controls. Put the explanation in your reply and only the visual in widget_code. Call read_me first. The user sees it right away; your reply can refer to it.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short snake_case name for the visual, such as checkout_flow.' },
        loading_messages: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'One to four short lines shown while it draws.' },
        widget_code: { type: 'string', description: 'An HTML fragment (no html, head or body), or an SVG starting with <svg.' },
      },
      required: ['title', 'loading_messages', 'widget_code'],
      additionalProperties: false,
    },
    annotations: { title: 'Show a visual', readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: VISUAL_APP_URI } },
  },
];

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const isId = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });

function callTool(name: unknown, args: Record<string, unknown>): unknown {
  if (name === 'read_me') return text(visualGuide(Array.isArray(args.modules) ? args.modules.filter((m): m is string => typeof m === 'string') : []));
  if (name === 'show_widget') {
    const code = typeof args.widget_code === 'string' ? args.widget_code : '';
    if (!code.trim()) return text('widget_code is empty: there is nothing to draw.', true);
    return text('The visual is shown to the user in the conversation, where you called show_widget.');
  }
  return null;
}

/** Answers one message; null when it needs no answer (a notification, or a response). */
export function handleVisualizeMessage(message: Message): object | null {
  if (!isId(message.id) || typeof message.method !== 'string') return null;
  const id = message.id;
  const params = record(message.params);
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, error: string) => ({ jsonrpc: '2.0', id, error: { code, message: error } });
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Draws visuals inline in the conversation. Call read_me before your first show_widget.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const result = callTool(params.name, record(params.arguments));
      return result ? ok(result) : fail(-32602, `No tool called ${String(params.name)}`);
    }
    case 'resources/list':
      return ok({ resources: [{ uri: VISUAL_APP_URI, name: 'visual', title: 'Visual', mimeType: MCP_APP_MIME_TYPE }] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'resources/read':
      if (params.uri !== VISUAL_APP_URI) return fail(-32002, `No resource ${String(params.uri)}`);
      return ok({ contents: [{ uri: VISUAL_APP_URI, mimeType: MCP_APP_MIME_TYPE, text: visualAppHtml(), _meta: { ui: { csp: VISUAL_APP_CSP, prefersBorder: false } } }] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

/**
 * The server over a stream of newline-delimited JSON-RPC (MCP's stdio transport): `write` gets each answer as a line.
 * Returns what takes a chunk of input.
 */
export function visualizeServer(write: (line: string) => void): (chunk: string) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      const answer = handleVisualizeMessage(message);
      if (answer) write(`${JSON.stringify(answer)}\n`);
    }
  };
}
