import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER_SOCKET_ENV, BROWSER_TOKEN_ENV, BROWSER_TOOLS, siteLabel, type BrowserBridgeRequest, type BrowserTool, type BrowserToolRequest, type BrowserToolResult } from '@seshboard/protocol';
import type { McpStdioServer } from '../providers/provider.ts';

/*
 * The engine's side of the browser tools (docs/browser.md, Agents in the browser). Every agent Seshboard runs (Claude
 * Code, Copilot, Codex) starts the same `browser` MCP server, with this socket's path and a token for its session.
 * Each call comes here: a page on this computer or a site the project allows runs at once; any other site asks you in
 * Seshboard first, whatever the agent. Main then drives the page (`run`).
 */

export interface BrowserBridgeDeps {
  /** Drives the session's page (main). */
  run(request: BrowserToolRequest): Promise<BrowserToolResult>;
  /** A page on this computer or a site the project allows runs at once; otherwise the site the prompt names. */
  access(sessionId: string, tool: BrowserTool, args: Record<string, unknown>): Promise<{ allow: true } | { allow: false; site: string }>;
  /** Asks you in the session's permission card; true when you allowed it ("Always allow" also keeps the site). */
  ask(sessionId: string, site: string, tool: BrowserTool, args: Record<string, unknown>): Promise<boolean>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Tests: where the socket goes. Defaults to the system's temporary folder (a named pipe on Windows). */
  socketParent?: string;
}

const fail = (text: string): BrowserToolResult => ({ text, error: true });

export class BrowserBridge {
  private server: Server | null = null;
  private listening: Promise<string> | null = null;
  private socketDir: string | null = null;
  /** Each token's session, read when a call comes: a fork changes it, and a pre-warmed process learns it late. */
  private readonly tokens = new Map<string, () => string | null>();

  constructor(private readonly deps: BrowserBridgeDeps) {}

  /** Starts listening, once; the socket's path. */
  private start(): Promise<string> {
    this.listening ??= new Promise((resolve, reject) => {
      const windows = process.platform === 'win32';
      let socketPath: string;
      if (windows) socketPath = `\\\\.\\pipe\\seshboard-browser-${randomBytes(16).toString('hex')}`;
      else {
        this.socketDir = mkdtempSync(join(this.deps.socketParent ?? tmpdir(), 'seshboard-'));
        socketPath = join(this.socketDir, 'browser.sock');
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
   * The `browser` server for one agent process: `base` (Seshboard's binary and the server's script, from main) with
   * the socket and a token of its own. `sessionId` says whose page its calls drive.
   */
  async serverFor(base: McpStdioServer, sessionId: () => string | null): Promise<McpStdioServer> {
    const socket = await this.start();
    const token = randomUUID();
    this.tokens.set(token, sessionId);
    return { command: base.command, args: [...base.args], env: { ...base.env, [BROWSER_SOCKET_ENV]: socket, [BROWSER_TOKEN_ENV]: token } };
  }

  /** One call: whose session, which site, then the page. Public for tests. */
  async handle(request: BrowserBridgeRequest): Promise<BrowserToolResult> {
    const sessionId = this.tokens.get(request.token)?.() ?? null;
    if (!sessionId) return fail('These browser tools are not tied to a session in Seshboard.');
    if (!(BROWSER_TOOLS as readonly string[]).includes(request.tool)) return fail(`No browser tool called ${request.tool}.`);
    const tool = request.tool as BrowserTool;
    const args = request.args && typeof request.args === 'object' ? request.args : {};
    const access = await this.deps.access(sessionId, tool, args);
    if (!access.allow && !(await this.deps.ask(sessionId, access.site, tool, args))) {
      return fail(`The user did not allow ${siteLabel(access.site)}. Work on pages on this computer, or ask them to allow the site in Seshboard.`);
    }
    return this.deps.run({ sessionId, tool, args });
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
        let request: BrowserBridgeRequest;
        try {
          request = JSON.parse(line) as BrowserBridgeRequest;
        } catch {
          continue;
        }
        if (typeof request.id !== 'number') continue;
        void this.handle(request)
          .catch((error: Error) => fail(`The browser could not do that: ${error.message}`))
          .then((result) => !socket.destroyed && socket.write(`${JSON.stringify({ id: request.id, result })}\n`));
      }
    });
    socket.on('error', (error) => this.deps.log('warn', `Browser tools: ${error.message}`));
  }

  close(): void {
    this.server?.close();
    this.server = null;
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }
}
