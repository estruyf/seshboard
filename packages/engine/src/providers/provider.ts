import type { Capabilities, ImageAttachment, LiveStatus, ModelOption, OptionalProvider, PermissionDecision, PermissionMode, PermissionRequest, ProviderMode, ProviderQuota, SlashCommand, StreamDelta } from '@seshboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';

/** How a provider keeps its sessions on disk, as far as the session index needs to know. */
export interface ProviderFiles {
  /**
   * The session a changed file belongs to (its path relative to the provider's folder, as the folder's watcher reports
   * it), and the file that stands for the session; null for any other file.
   */
  sessionOf(relativePath: string): { sessionId: string; file: string } | null;
  /** Every session's file, by session id: what a full scan finds. */
  files(): Map<string, string>;
}

/**
 * Everything Seshboard knows about one agent besides Claude Code. Adding a provider is one module that returns this,
 * its id and name in `@seshboard/protocol`'s `providerConstants.ts`, and one line in `registry.ts`; the session index,
 * the sidebar, search, the transcript view and Settings › Profiles take it from there (docs/providers.md).
 *
 * `source` lists and reads sessions. `driver`, when a provider has one, starts and steers them; without it the
 * provider's sessions are read-only.
 */
export interface ProviderAdapter {
  id: OptionalProvider;
  /** The profile it is (Settings › Profiles): one adapter per profile, each with its own folder, runtime and login. */
  profileId: string;
  /** The profile's config folder (`COPILOT_HOME`), which its CLI runs with. */
  home: string;
  /** The folder its sessions are in. Watched once the provider is allowed; Seshboard never creates or writes it. */
  folder: string;
  files: ProviderFiles;
  /** Lists and reads its sessions, as Claude Code's transcript messages (`RawSessionMessage`). */
  source: SessionSource;
  /** The command that continues a session in the provider's own CLI, with `{sessionId}` where the id goes. */
  resumeCommand: string;
  /** The command that signs in with the provider's own CLI, run in a terminal with the profile's environment. */
  signInCommand?: string;
  /** Starts and steers its sessions. Optional: a provider without one is read-only. */
  driver?: ProviderDriver;
  /** The session is open in the provider's own app right now (not through Seshboard), so it can't be resumed here. */
  inUse?(sessionId: string): boolean;
  /**
   * The sessions among `sessionIds` open in the provider's own app right now, and how they are: the sidebar shows them
   * working or waiting, as it does Claude Code sessions in a terminal.
   */
  live?(sessionIds: readonly string[]): Array<{ sessionId: string; pid: number; status: LiveStatus; updatedAt: number | null }>;
}

/**
 * Whether the provider's CLI can run sessions here. Signing in is the provider's own business: Seshboard never asks
 * for, stores or passes a credential, and only says how to sign in with the provider's CLI.
 */
export interface DriverStatus {
  /** Its CLI was found (the path, else null). */
  binary: string | null;
  version: string | null;
  signedIn: boolean;
  /** Who it is signed in as, in the provider's words (`estruyf (via gh)`). */
  account: string | null;
  /** The account's login name (`estruyf`), when the provider says it. */
  login: string | null;
  /** What to do when it can't run: install it, or sign in with its CLI. Null when it can. */
  problem: string | null;
}

/** What a running session tells Seshboard, in the shapes Claude Code's sessions use (`HostEvents`). */
export interface DriverEvents {
  /** Text, thinking or a tool name as it streams; `clear` when a complete message replaces it. */
  stream(delta: Omit<StreamDelta, 'sessionId'>): void;
  /** Complete messages, as the session's reader will read them from disk later. */
  messages(messages: RawSessionMessage[]): void;
  /** The turn started, ended, or failed (with the provider's message). */
  state(state: 'running' | 'idle' | 'error', error?: string): void;
  /** The provider asks before a tool runs; `respond` on the session answers it. */
  permission(request: Omit<PermissionRequest, 'sessionId'>): void;
  /** A request was answered or dropped (the turn was stopped). */
  permissionDone(requestId: string): void;
  /** How full the context is, and what the session has spent in the provider's own unit (Copilot's premium requests). */
  usage(usage: { contextTokens?: number; contextMax?: number; spent?: { amount: number; unit: string } }): void;
  /** The session's model changed (by a command, or the provider's Auto picking one). */
  model(model: string): void;
}

export interface DriverSessionConfig {
  cwd: string;
  /** Resume this session; a new one when missing. */
  resume?: string;
  model: string | null;
  /** One of the driver's `modes`. */
  permissionMode: PermissionMode;
}

/** One running session of a provider. */
export interface DriverSession {
  readonly sessionId: string;
  /**
   * Sends a message; resolves once the provider took it. Returns the message's id. `steer` hands it to the turn under
   * way at its next step instead of after it.
   */
  send(text: string, attachments: readonly ImageAttachment[], steer?: boolean): Promise<string>;
  /** Switches to another of the driver's `modes`. */
  setMode(mode: PermissionMode): Promise<void>;
  /**
   * The provider's slash commands for this session, for the message box's `/` list. A message that starts with one
   * runs it (`send`): a command that answers in words without a turn ends with `state('idle')`.
   */
  commands(): Promise<SlashCommand[]>;
  /** What the session can use (Tools): its MCP servers, agents and skills. */
  capabilities(): Promise<Capabilities>;
  /** Turns one of its MCP servers on or off, or connects it again. */
  mcp(server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void>;
  /** Stops the current turn. */
  interrupt(): Promise<void>;
  setModel(model: string | null): Promise<void>;
  respond(requestId: string, decision: PermissionDecision): void;
  /** Lets go of the session (it stays on disk, to resume later). */
  close(): Promise<void>;
}

export interface ProviderDriver {
  /**
   * Seshboard's permission modes this provider has, with what each means for it (its own words where it differs from
   * Claude Code's). The message box offers these; the first is the default.
   */
  modes: ProviderMode[];
  status(): Promise<DriverStatus>;
  /** The account's premium requests this period (Copilot's), when the provider has them. */
  quota?(): Promise<ProviderQuota | null>;
  models(): Promise<ModelOption[]>;
  /** The slash commands a new session has, before one runs here. */
  commands(): Promise<SlashCommand[]>;
  start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession>;
  /** Stops the provider's runtime (the app quits). */
  dispose(): Promise<void>;
}
