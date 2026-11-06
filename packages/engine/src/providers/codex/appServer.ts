import type { ReadMethods } from './protocol.ts';

/** Where `codex` is, and how to start it (an npm install on Windows runs its script with `node`). */
export interface CodexBinary {
  path: string;
  args?: string[];
  version: string | null;
}

export interface AppServerOptions {
  /** Found again until found: installing Codex works without restarting Seshboard. Null when it isn't installed. */
  binary: () => Promise<CodexBinary | null>;
  /** The environment `codex app-server` runs with, `CODEX_HOME` set to the profile's folder. */
  env: () => Promise<Record<string, string | undefined>>;
  /** Stops the process after this long without a request (it is started again on the next one). */
  idleMs?: number;
  /** How long one request may take before it fails. */
  timeoutMs?: number;
}

/**
 * One `codex app-server` for one profile, spoken to over JSON-RPC on stdio (one JSON object per line). Started on the
 * first request, with `initialize` (`clientInfo.name: 'seshboard'`) and `initialized`, and stopped when idle. A crash
 * fails the requests in flight and the next request starts it again. Never throws from an event handler: a broken
 * Codex can't take the engine down.
 */
export interface AppServer {
  request<M extends keyof ReadMethods>(method: M, params: ReadMethods[M]['params']): Promise<ReadMethods[M]['result']>;
  /** The process's pid while it runs (its own locks don't mean a session is open elsewhere). */
  pid(): number | null;
  dispose(): Promise<void>;
}

export function createAppServer(_options: AppServerOptions): AppServer {
  throw new Error('createAppServer: not built yet');
}
