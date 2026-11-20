import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER_SOCKET_ENV, BROWSER_TOKEN_ENV, BROWSER_TOOLS, browserAccess, siteLabel, type BrowserAnswer, type BrowserAsk, type BrowserBridgeRequest, type BrowserTool, type BrowserToolRequest, type BrowserToolResult } from '@seshboard/protocol';
import type { McpStdioServer } from '../providers/provider.ts';

/*
 * The engine's side of the browser tools (docs/browser.md, Agents in the browser). Every agent Seshboard runs (Claude
 * Code, Copilot, Codex) starts the same `browser` MCP server, with this socket's path and a token for its session.
 * Each call comes here: a page on this computer or a site the project allows runs at once; any other site asks you in
 * Seshboard first, whatever the agent. evaluate and network need Allow scripts in pages, and ask on a card of their
 * own for a site that isn't on this computer (`browserAccess`). Main then drives the page (`run`).
 */

export interface BrowserBridgeDeps {
  /** Drives the session's page (main). */
  run(request: BrowserToolRequest): Promise<BrowserToolResult>;
  /**
   * `open`'s browser profile (docs/browser.md, Browser profiles), by the name the agent gave, among the ones the
   * session's project can use: its id and name (null for the Default one), or why there is none. Left out: Default only.
   */
  profile?(sessionId: string, name: string | null): { id: string | null; name: string | null } | { error: string };
  /**
   * The address a call works on (the one `open` loads, else the session's page; null with no page) and the browser
   * profile it acts in (its name, null for the Default one).
   */
  where(sessionId: string, tool: BrowserTool, args: Record<string, unknown>): Promise<{ url: string | null; profile: string | null }>;
  /** The sites the session's project allows, for the tools and for scripts; `project` is false outside an added project. */
  sites(sessionId: string): { sites: readonly string[]; scriptSites: readonly string[]; project: boolean };
  /** Settings › Browser › Allow scripts in pages, now: off, evaluate and network are refused even in sessions that list them. */
  scripts(): boolean;
  /** Asks you in the session's permission card: to use a site, or to run scripts on it. */
  ask(sessionId: string, ask: BrowserAsk): Promise<BrowserAnswer>;
  /** "Always allow": the session's project keeps the site, for the tools or for scripts. */
  keep(sessionId: string, kind: BrowserAsk['kind'], site: string): void;
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
  /**
   * "Allow for this session": each session's sites, for the tools and for scripts. In memory only, so an engine
   * restart forgets them; a session's next card asks again.
   */
  private readonly sessionAllowed = new Map<string, { site: Set<string>; scripts: Set<string> }>();

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
    // `profileId` and `profileName` are the bridge's own, never the agent's: it names a profile, the bridge finds it.
    const { profileId: _id, profileName: _name, ...given } = request.args && typeof request.args === 'object' ? request.args : {};
    let args: Record<string, unknown> = given;
    if (tool === 'open') {
      const named = typeof given.profile === 'string' ? given.profile : null;
      const found = this.deps.profile ? this.deps.profile(sessionId, named) : { id: null, name: null };
      if ('error' in found) return fail(found.error);
      args = { ...given, profileId: found.id, profileName: found.name };
    }
    const where = await this.deps.where(sessionId, tool, args);
    const { sites, scriptSites, project } = this.deps.sites(sessionId);
    const ours = this.sessionAllowed.get(sessionId);
    const access = browserAccess({ tool, url: where.url, scripts: this.deps.scripts(), sites, scriptSites, sessionSites: [...(ours?.site ?? [])], sessionScriptSites: [...(ours?.scripts ?? [])] });
    if ('refuse' in access) return fail(access.refuse);
    if ('ask' in access) {
      const answer = await this.deps.ask(sessionId, { kind: access.ask, site: access.site, tool, input: given, profile: where.profile, project });
      if (answer === 'deny') {
        return fail(
          access.ask === 'scripts'
            ? `The user did not allow scripts on ${siteLabel(access.site)}. Use read, snapshot and the other tools there, or ask them to allow scripts in Seshboard.`
            : `The user did not allow ${siteLabel(access.site)}. Work on pages on this computer, or ask them to allow the site in Seshboard.`,
        );
      }
      if (answer === 'session') this.allowForSession(sessionId, access.ask, access.site);
      // Outside an added project there is nothing to keep it in: it counts for this session.
      if (answer === 'always') project ? this.deps.keep(sessionId, access.ask, access.site) : this.allowForSession(sessionId, access.ask, access.site);
    }
    return this.deps.run({ sessionId, tool, args });
  }

  private allowForSession(sessionId: string, kind: BrowserAsk['kind'], site: string): void {
    const ours = this.sessionAllowed.get(sessionId) ?? { site: new Set<string>(), scripts: new Set<string>() };
    (kind === 'scripts' ? ours.scripts : ours.site).add(site);
    this.sessionAllowed.set(sessionId, ours);
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
