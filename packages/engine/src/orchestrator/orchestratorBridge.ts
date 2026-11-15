import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORCHESTRATOR_SOCKET_ENV, ORCHESTRATOR_TOKEN_ENV, ORCHESTRATOR_TOOLS, type OrchestratorBridgeRequest, type OrchestratorTool, type OrchestratorToolResult } from '@seshboard/protocol';
import type { McpStdioServer } from '../providers/provider.ts';

/*
 * The engine's side of the orchestrator's tools (docs/orchestrator.md), built like the browser tools' bridge
 * (`browser/browserBridge.ts`). Every agent that runs an orchestrator (Claude Code, Copilot, Codex) starts the same
 * `orchestrator` MCP server, with this socket's path and a token for its session. Each call comes here, and goes on
 * only when the token's session is an orchestrator.
 */

export interface OrchestratorBridgeDeps {
  /** Runs one tool for an orchestrator session. */
  run(sessionId: string, tool: OrchestratorTool, args: Record<string, unknown>): Promise<OrchestratorToolResult>;
  isOrchestrator(sessionId: string): boolean;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Tests: where the socket goes. Defaults to the system's temporary folder (a named pipe on Windows). */
  socketParent?: string;
}

const fail = (text: string): OrchestratorToolResult => ({ text, error: true });

export class OrchestratorBridge {
  private server: Server | null = null;
  private listening: Promise<string> | null = null;
  private socketDir: string | null = null;
  /** Each token's session, read when a call comes: a new session learns its id after its process started. */
  private readonly tokens = new Map<string, () => string | null>();

  constructor(private readonly deps: OrchestratorBridgeDeps) {}

  /** Starts listening, once; the socket's path. */
  private start(): Promise<string> {
    this.listening ??= new Promise((resolve, reject) => {
      const windows = process.platform === 'win32';
      let socketPath: string;
      if (windows) socketPath = `\\\\.\\pipe\\seshboard-orchestrator-${randomBytes(16).toString('hex')}`;
      else {
        this.socketDir = mkdtempSync(join(this.deps.socketParent ?? tmpdir(), 'seshboard-'));
        socketPath = join(this.socketDir, 'orchestrator.sock');
      }
      const server = createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(socketPath, () => {
        if (!windows) chmodSync(socketPath, 0o600);
        resolve(socketPath);
      });
      this.server = server;
    });
    return this.listening;
  }

  /**
   * The `orchestrator` server for one agent process: `base` (Seshboard's binary and the server's script, from main)
   * with the socket and a token of its own. `sessionId` says which orchestrator its calls are for.
   */
  async serverFor(base: McpStdioServer, sessionId: () => string | null): Promise<McpStdioServer> {
    const socket = await this.start();
    const token = randomUUID();
    this.tokens.set(token, sessionId);
    return { command: base.command, args: [...base.args], env: { ...base.env, [ORCHESTRATOR_SOCKET_ENV]: socket, [ORCHESTRATOR_TOKEN_ENV]: token } };
  }

  /** One call: whose session, is it an orchestrator, then the tool. Public for tests. */
  async handle(request: OrchestratorBridgeRequest): Promise<OrchestratorToolResult> {
    const sessionId = this.tokens.get(request.token)?.() ?? null;
    if (!sessionId) return fail('These tools are not tied to a session in Seshboard.');
    if (!this.deps.isOrchestrator(sessionId)) return fail('This session is not an orchestrator in Seshboard.');
    if (!(ORCHESTRATOR_TOOLS as readonly string[]).includes(request.tool)) return fail(`No orchestrator tool called ${request.tool}.`);
    const args = request.args && typeof request.args === 'object' ? request.args : {};
    return this.deps.run(sessionId, request.tool as OrchestratorTool, args);
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        let request: OrchestratorBridgeRequest;
        try {
          request = JSON.parse(line) as OrchestratorBridgeRequest;
        } catch {
          continue;
        }
        if (typeof request.id !== 'number') continue;
        void this.handle(request)
          .catch((error: Error) => fail(`The orchestrator could not do that: ${error.message}`))
          .then((result) => !socket.destroyed && socket.write(`${JSON.stringify({ id: request.id, result })}\n`));
      }
    });
    socket.on('error', (error) => this.deps.log('warn', `Orchestrator tools: ${error.message}`));
  }

  close(): void {
    this.server?.close();
    this.server = null;
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }
}
