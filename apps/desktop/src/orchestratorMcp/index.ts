import { connect } from 'node:net';
import { ORCHESTRATOR_ROLE_ENV, ORCHESTRATOR_SOCKET_ENV, ORCHESTRATOR_TOKEN_ENV, SESSION_TOOL_SET_ENV, toolSetOf, type OrchestratorBridgeReply, type OrchestratorBridgeRequest, type OrchestratorToolResult } from '@seshboard/protocol';
import { lineReader } from '../browserMcp/server.ts';
import { orchestratorMcpServer } from './server.ts';

// Seshboard's `orchestrator` MCP server, over stdio: an agent starts it as Seshboard's own binary run as Node
// (ELECTRON_RUN_AS_NODE). Each call goes to the engine over its local socket, with the session's token; it ends when the
// agent closes its input.
const socketPath = process.env[ORCHESTRATOR_SOCKET_ENV] ?? '';
const token = process.env[ORCHESTRATOR_TOKEN_ENV] ?? '';
// A session that is not an orchestrator lists the `seshboard` server's tools, the set its project gives it.
const role = process.env[ORCHESTRATOR_ROLE_ENV] === 'session' ? 'session' : 'orchestrator';
const set = toolSetOf(process.env[SESSION_TOOL_SET_ENV]);

let nextId = 1;
const pending = new Map<number, (result: OrchestratorToolResult) => void>();
const offline = (): OrchestratorToolResult => ({ text: 'Seshboard is not reachable: the orchestrator tools only work in sessions Seshboard runs.', error: true });
const socket = socketPath ? connect(socketPath) : null;
socket?.setEncoding('utf8');
socket?.on(
  'data',
  lineReader((line) => {
    try {
      const reply = JSON.parse(line) as OrchestratorBridgeReply;
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

const take = orchestratorMcpServer(
  (line) => process.stdout.write(line),
  (tool, args) =>
    new Promise((resolve) => {
      if (!socket || socket.destroyed) return resolve(offline());
      const id = nextId++;
      pending.set(id, resolve);
      const request: OrchestratorBridgeRequest = { id, token, tool, args };
      socket.write(`${JSON.stringify(request)}\n`);
    }),
  role,
  set,
);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => take(chunk));
process.stdin.on('end', () => process.exit(0));
