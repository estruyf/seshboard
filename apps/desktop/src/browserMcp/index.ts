import { connect } from 'node:net';
import { BROWSER_SOCKET_ENV, BROWSER_TOKEN_ENV, type BrowserBridgeReply, type BrowserBridgeRequest, type BrowserToolResult } from '@seshboard/protocol/bridge';
import { browserMcpServer, lineReader } from './server.ts';

// Seshboard's `browser` MCP server, over stdio: an agent starts it as Seshboard's own binary run as Node
// (ELECTRON_RUN_AS_NODE). Each call goes to the engine over its local socket, with the session's token; it ends when the
// agent closes its input.
const socketPath = process.env[BROWSER_SOCKET_ENV] ?? '';
const token = process.env[BROWSER_TOKEN_ENV] ?? '';

let nextId = 1;
const pending = new Map<number, (result: BrowserToolResult) => void>();
const offline = (): BrowserToolResult => ({ text: 'Seshboard is not reachable: the browser tools only work in sessions Seshboard runs.', error: true });
const socket = socketPath ? connect(socketPath) : null;
socket?.setEncoding('utf8');
socket?.on(
  'data',
  lineReader((line) => {
    try {
      const reply = JSON.parse(line) as BrowserBridgeReply;
      pending.get(reply.id)?.(reply.result);
      pending.delete(reply.id);
    } catch {
      // Not a reply: nothing waits for it.
    }
  }),
);
const dropAll = () => {
  for (const resolve of pending.values()) resolve(offline());
  pending.clear();
};
socket?.on('error', dropAll);
socket?.on('close', dropAll);

const take = browserMcpServer(
  (line) => process.stdout.write(line),
  (tool, args) =>
    new Promise((resolve) => {
      if (!socket || socket.destroyed) return resolve(offline());
      const id = nextId++;
      pending.set(id, resolve);
      const request: BrowserBridgeRequest = { id, token, tool, args };
      socket.write(`${JSON.stringify(request)}\n`);
    }),
);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => take(chunk));
process.stdin.on('end', () => process.exit(0));
