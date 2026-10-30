import type { ImageAttachment, ModelOption, PermissionDecision } from '@seshboard/protocol';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, ProviderDriver } from '../provider.ts';
import type { CopilotEvent } from './copilotEvents.ts';
import { CopilotLive } from './copilotLive.ts';
import { toCopilotDecision, toPermissionRequest } from './copilotPermissions.ts';

/** The subset of the Copilot SDK's `CopilotSession` the driver uses (tests fake it). */
export interface CopilotSdkSession {
  readonly sessionId: string;
  on(handler: (event: CopilotEvent) => void): () => void;
  send(options: { prompt: string; attachments?: Array<{ type: 'blob'; data: string; mimeType: string; displayName?: string }> }): Promise<string>;
  abort(): Promise<void>;
  setModel(model: string): Promise<void>;
  disconnect(): Promise<void>;
}

type PermissionAnswer = ReturnType<typeof toCopilotDecision> | { kind: 'user-not-available' };

export interface CopilotSessionOptions {
  workingDirectory: string;
  model?: string;
  streaming: boolean;
  clientName: string;
  onPermissionRequest(request: Record<string, unknown>, invocation: { sessionId: string }): Promise<PermissionAnswer>;
}

/** The subset of the Copilot SDK's `CopilotClient` the driver uses (tests fake it). */
export interface CopilotSdkClient {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  getAuthStatus(): Promise<{ isAuthenticated: boolean; login?: string; statusMessage?: string }>;
  listModels(): Promise<Array<{ id: string; name: string; capabilities?: { supports?: { reasoningEffort?: boolean } } }>>;
  createSession(options: CopilotSessionOptions): Promise<CopilotSdkSession>;
  resumeSession(sessionId: string, options: CopilotSessionOptions): Promise<CopilotSdkSession>;
}

/** Makes the client for the user's `copilot` (the real one loads the SDK; tests pass a fake). */
export type CreateCopilotClient = (options: { cliPath: string; env: Record<string, string | undefined> }) => Promise<CopilotSdkClient>;

/** The name Copilot records for sessions Seshboard starts (`client_name` in `workspace.yaml`). */
export const SESHBOARD_CLIENT = 'seshboard';

/**
 * The real client: the Copilot SDK (loaded on first use), running the user's own `copilot` in headless mode. No token
 * is passed: `copilot` uses its own login (`copilot` then `/login`, or the GitHub CLI's), which Seshboard never sees.
 */
export const sdkCopilotClient: CreateCopilotClient = async ({ cliPath, env }) => {
  const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk');
  const clean = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return new CopilotClient({ connection: RuntimeConnection.forStdio({ path: cliPath, env: clean }), logLevel: 'error' }) as unknown as CopilotSdkClient;
};

export interface CopilotDriverOptions {
  /** The user's `copilot` (null: not installed), looked up when first needed. */
  binary(): Promise<{ path: string; version: string | null } | null>;
  /** The environment `copilot` runs with: the login shell's, so its own config and login are found. */
  env(): Promise<Record<string, string | undefined>>;
  createClient?: CreateCopilotClient;
}

const INSTALL = 'Install GitHub Copilot CLI to start Copilot sessions here.';
const SIGN_IN = 'Sign in to GitHub Copilot CLI: run `copilot` in a terminal and use /login. Seshboard uses that login.';

/**
 * Starts and steers GitHub Copilot sessions through the Copilot SDK, with one headless `copilot` runtime for all of
 * them (started on first use). Events become Claude Code's shapes (`CopilotLive`), permission requests the permission
 * card's (`copilotPermissions.ts`).
 */
export function copilotDriver(options: CopilotDriverOptions): ProviderDriver {
  const create = options.createClient ?? sdkCopilotClient;
  let client: Promise<CopilotSdkClient> | undefined;
  const connect = () => {
    client ??= (async () => {
      const binary = await options.binary();
      if (!binary) throw new Error(INSTALL);
      const started = await create({ cliPath: binary.path, env: await options.env() });
      await started.start();
      return started;
    })().catch((error: unknown) => {
      // Not cached: installing or signing in later should work without restarting Seshboard.
      client = undefined;
      throw error;
    });
    return client;
  };

  return {
    async status(): Promise<DriverStatus> {
      const binary = await options.binary();
      if (!binary) return { binary: null, version: null, signedIn: false, account: null, problem: INSTALL };
      try {
        const auth = await (await connect()).getAuthStatus();
        return { binary: binary.path, version: binary.version, signedIn: auth.isAuthenticated, account: auth.statusMessage ?? auth.login ?? null, problem: auth.isAuthenticated ? null : SIGN_IN };
      } catch (error) {
        return { binary: binary.path, version: binary.version, signedIn: false, account: null, problem: (error as Error).message };
      }
    },

    async models(): Promise<ModelOption[]> {
      const models = await (await connect()).listModels();
      return models.map((m) => ({ value: m.id, displayName: m.name, description: '', supportsEffort: m.capabilities?.supports?.reasoningEffort === true }));
    },

    async start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession> {
      const sdk = await connect();
      const pending = new Map<string, (answer: PermissionAnswer) => void>();
      const sessionOptions: CopilotSessionOptions = {
        workingDirectory: config.cwd,
        ...(config.model ? { model: config.model } : {}),
        streaming: true,
        clientName: SESHBOARD_CLIENT,
        onPermissionRequest: (request) =>
          new Promise<PermissionAnswer>((resolve) => {
            const requestId = typeof request.requestId === 'string' ? request.requestId : `copilot-${Date.now()}-${pending.size}`;
            pending.set(requestId, resolve);
            events.permission(toPermissionRequest(requestId, request));
          }),
      };
      const session = config.resume ? await sdk.resumeSession(config.resume, sessionOptions) : await sdk.createSession(sessionOptions);
      const live = new CopilotLive(events);
      const off = session.on((event) => live.handle(event));
      /** Answers every open request as nobody being there (a stopped turn, a closed session). */
      const dropAll = () => {
        for (const [requestId, resolve] of pending) {
          resolve({ kind: 'user-not-available' });
          events.permissionDone(requestId);
        }
        pending.clear();
      };
      return {
        sessionId: session.sessionId,
        async send(text: string, attachments: readonly ImageAttachment[]) {
          const blobs = attachments.map((a) => ({ type: 'blob' as const, data: a.data, mimeType: a.mediaType, ...(a.name ? { displayName: a.name } : {}) }));
          return session.send({ prompt: text, ...(blobs.length ? { attachments: blobs } : {}) });
        },
        async interrupt() {
          dropAll();
          await session.abort();
        },
        async setModel(model: string | null) {
          // Copilot's own default is `auto`.
          await session.setModel(model ?? 'auto');
        },
        respond(requestId: string, decision: PermissionDecision) {
          const resolve = pending.get(requestId);
          if (!resolve) return;
          pending.delete(requestId);
          resolve(toCopilotDecision(decision));
          events.permissionDone(requestId);
          if (decision.behavior === 'deny' && decision.interrupt) void session.abort().catch(() => {});
        },
        async close() {
          dropAll();
          off();
          await session.disconnect();
        },
      };
    },

    async dispose() {
      const current = client;
      client = undefined;
      if (current) await (await current.catch(() => null))?.stop();
    },
  };
}
