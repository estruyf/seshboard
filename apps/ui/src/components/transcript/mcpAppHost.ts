import { MCP_APP_MIME_TYPE, MCP_APP_PROTOCOL_VERSION, type McpAppCsp } from '@seshboard/protocol/client';
import { linkToOpen, MAX_VISUAL_HEIGHT } from './visuals.ts';

/**
 * Seshboard as the host of an MCP App's page (the MCP Apps spec, SEP-1865): JSON-RPC 2.0 over `postMessage` with the
 * page's frame. The page starts with `ui/initialize` and gets the host's context (theme, variables, limits); once it
 * says it is initialized it gets the tool call's input and result. It may call its server's tools and read its
 * resources (the engine decides what it may), open links, put a message in the message box and report its size.
 * Pure, for testing; `McpAppBlock.tsx` connects it to the frame.
 */

/** What the page learns about where it is drawn (`hostContext`). */
export interface McpAppHostContext {
  theme: 'light' | 'dark';
  styles: { variables: Record<string, string> };
  displayMode: 'inline';
  availableDisplayModes: ['inline'];
  containerDimensions: { maxHeight: number };
  locale: string;
  timeZone: string;
  platform: 'desktop';
  toolInfo: { tool: { name: string } };
}

export interface McpAppHostOptions {
  /** Sends a message to the page. */
  post(message: object): void;
  /** The context now (read when the page asks, and again when it changes). */
  context(): McpAppHostContext;
  /** The tool call's arguments, and its result as the server sent it (null while it runs). */
  toolInput: Record<string, unknown>;
  toolResult: unknown;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string): Promise<{ contents: unknown[] }>;
  /** An http(s) link, already checked. */
  openLink(url: string): void;
  /** Text the page wants to send as you: it goes in the message box, for you to send. */
  message(text: string): void;
  resize(height: number): void;
  log(level: string, data: unknown): void;
}

export interface McpAppHost {
  /** A message from the page's frame (the caller checks it came from that frame). */
  receive(data: unknown): void;
  /** The theme or the variables changed. */
  contextChanged(): void;
  /** The call finished while the page was open: it gets the result (once). */
  setResult(result: unknown): void;
  /** The page is going away: it may save what it has. */
  teardown(): void;
}

type Id = string | number;
const isId = (v: unknown): v is Id => typeof v === 'string' || typeof v === 'number';
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The text of a `ui/message`: one text block, or a list of them. */
function messageText(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => record(block))
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n\n')
    .trim();
}

export function createMcpAppHost(options: McpAppHostOptions): McpAppHost {
  let initialized = false;
  let result = options.toolResult;
  let resultSent = false;
  const sendResult = () => {
    if (!initialized || resultSent || result === null || result === undefined) return;
    resultSent = true;
    notify('ui/notifications/tool-result', result);
  };
  const respond = (id: Id, result: unknown) => options.post({ jsonrpc: '2.0', id, result });
  const fail = (id: Id, code: number, message: string) => options.post({ jsonrpc: '2.0', id, error: { code, message } });
  const notify = (method: string, params: unknown) => options.post({ jsonrpc: '2.0', method, params });
  const answer = (id: Id, work: Promise<unknown>) =>
    work.then(
      (result) => respond(id, result),
      (error: unknown) => fail(id, -32000, error instanceof Error ? error.message : String(error)),
    );

  const request = (id: Id, method: string, params: Record<string, unknown>) => {
    switch (method) {
      // `initialize` too: pages written against an earlier draft use plain MCP's name.
      case 'ui/initialize':
      case 'initialize':
        return respond(id, {
          protocolVersion: MCP_APP_PROTOCOL_VERSION,
          hostInfo: { name: 'Seshboard', version: '1' },
          hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {}, logging: {} },
          hostContext: options.context(),
        });
      case 'ping':
        return respond(id, {});
      case 'tools/call': {
        if (typeof params.name !== 'string' || !params.name) return fail(id, -32602, 'tools/call needs a tool name.');
        return answer(id, options.callTool(params.name, record(params.arguments)));
      }
      case 'resources/read': {
        if (typeof params.uri !== 'string' || !params.uri) return fail(id, -32602, 'resources/read needs a URI.');
        return answer(id, options.readResource(params.uri));
      }
      case 'ui/open-link': {
        const url = linkToOpen(params.url);
        if (!url) return fail(id, -32602, 'Invalid URL');
        options.openLink(url);
        return respond(id, {});
      }
      case 'ui/message': {
        const text = messageText(params.content);
        if (!text) return fail(id, -32602, 'Invalid message format');
        options.message(text.slice(0, 20_000));
        return respond(id, {});
      }
      // Only inline: the page stays in the conversation.
      case 'ui/request-display-mode':
        return respond(id, { mode: 'inline' });
      // Taken but not passed on: Seshboard doesn't add a page's context to the agent's next turn yet.
      case 'ui/update-model-context':
        return respond(id, {});
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  };

  const notification = (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'ui/notifications/initialized':
        if (initialized) return;
        initialized = true;
        notify('ui/notifications/tool-input', { arguments: options.toolInput });
        sendResult();
        return;
      case 'ui/notifications/size-changed': {
        const height = params.height;
        if (typeof height === 'number' && Number.isFinite(height) && height >= 0) options.resize(Math.min(Math.ceil(height), MAX_VISUAL_HEIGHT));
        return;
      }
      case 'notifications/message':
        return options.log(typeof params.level === 'string' ? params.level : 'info', params.data);
      default:
        return;
    }
  };

  return {
    receive(data) {
      const message = record(data);
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
      const params = record(message.params);
      if (isId(message.id)) request(message.id, message.method, params);
      else notification(message.method, params);
    },
    contextChanged() {
      if (initialized) notify('ui/notifications/host-context-changed', options.context());
    },
    setResult(next) {
      result = next;
      sendResult();
    },
    teardown() {
      if (initialized) options.post({ jsonrpc: '2.0', id: 'teardown', method: 'ui/resource-teardown', params: { reason: 'Seshboard closed the view' } });
    },
  };
}

/** The page in a `resources/read` answer: its HTML and the origins it declared, or null when there is none. */
export function mcpAppPage(contents: readonly unknown[], uri: string): { html: string; csp: McpAppCsp | null; prefersBorder: boolean | null } | null {
  const found = contents.map(record).find((c) => (c.uri === uri || contents.length === 1) && (typeof c.text === 'string' || typeof c.blob === 'string'));
  if (!found) return null;
  const mime = typeof found.mimeType === 'string' ? found.mimeType.replace(/\s+/g, '').toLowerCase() : MCP_APP_MIME_TYPE;
  if (!mime.startsWith('text/html')) return null;
  const html = typeof found.text === 'string' ? found.text : decodeBase64(found.blob as string);
  if (html === null) return null;
  const ui = record(record(found._meta).ui);
  const csp = Object.keys(record(ui.csp)).length ? (record(ui.csp) as McpAppCsp) : null;
  return { html, csp, prefersBorder: typeof ui.prefersBorder === 'boolean' ? ui.prefersBorder : null };
}

function decodeBase64(blob: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(blob), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
