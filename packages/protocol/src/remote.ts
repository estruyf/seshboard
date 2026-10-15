import { z } from 'zod';
import type { ContractShape } from './rpc.ts';
import { CompanionStatus } from './companion.ts';
import { PermissionDecision, QueuedMessage, SendMode, StreamDelta } from './host.ts';
import { MAX_PROMPT_LENGTH } from './promptConstants.ts';

/**
 * Remote's contracts: what a paired phone may ask the engine, and the one request of a phone that is pairing. They
 * are their own contracts, not the app's: a new method in `contract.ts` never becomes reachable from a phone by
 * accident. Each result is a smaller remote type, without what a phone has no use for (other profiles' paths,
 * settings, the environment). See docs/remote-access.md.
 */

const SessionId = z.string().min(1).max(200);
const Prompt = z.string().trim().min(1).max(MAX_PROMPT_LENGTH);
/** A project as the phone knows it: an opaque id, never its path. */
const ProjectId = z.string().regex(/^[a-f0-9]{16}$/);
/** The name a phone gives itself while pairing ("Elio's iPhone"). */
export const DeviceName = z.string().trim().min(1).max(60);

export const RemoteSession = z.object({
  id: z.string(),
  title: z.string(),
  projectId: ProjectId,
  projectName: z.string(),
  branch: z.string().nullable(),
  status: CompanionStatus,
  updatedAt: z.number(),
});
export type RemoteSession = z.infer<typeof RemoteSession>;

/** A permission prompt, question or plan waiting for an answer, as the card on the Mac shows it. */
export const RemotePrompt = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  input: z.json(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** What "Always allow" would do; null when not offered. */
  alwaysLabel: z.string().nullable(),
  createdAt: z.number(),
});
export type RemotePrompt = z.infer<typeof RemotePrompt>;

export const RemoteSessions = z.object({
  /** Needs you first, then working, then the most recent. */
  sessions: z.array(RemoteSession),
  /** What those sessions wait on you for, oldest first. */
  prompts: z.array(RemotePrompt),
});
export type RemoteSessions = z.infer<typeof RemoteSessions>;

export const RemoteProject = z.object({ id: ProjectId, name: z.string() });
export type RemoteProject = z.infer<typeof RemoteProject>;

/** A transcript block for the phone: images are only a placeholder, tool output is plain text. */
export const RemoteBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.json(), truncated: z.boolean() }),
  z.object({ type: z.literal('tool_result'), toolUseId: z.string(), isError: z.boolean(), text: z.string(), truncated: z.boolean() }),
  z.object({ type: z.literal('image') }),
  z.object({ type: z.literal('unknown'), kind: z.string() }),
]);
export type RemoteBlock = z.infer<typeof RemoteBlock>;

export const RemoteMessage = z.object({
  uuid: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  timestamp: z.number().nullable(),
  parentToolUseId: z.string().nullable(),
  blocks: z.array(RemoteBlock),
  /** The paired phone that sent it, for your own messages sent from a phone. */
  device: z.string().optional(),
});
export type RemoteMessage = z.infer<typeof RemoteMessage>;

export const RemoteTranscriptUpdate = z.object({
  sessionId: z.string(),
  mode: z.enum(['append', 'replace']),
  messages: z.array(RemoteMessage),
});
export type RemoteTranscriptUpdate = z.infer<typeof RemoteTranscriptUpdate>;

/** The most messages one `transcript.get` returns. */
export const REMOTE_PAGE_LIMIT = 200;

export const remoteContract = {
  requests: {
    /** The first request on a connection, after the handshake. */
    hello: {
      params: z.object({ client: z.object({ version: z.string().max(50) }) }),
      result: z.object({ app: z.object({ version: z.string() }), device: z.object({ id: z.string(), name: z.string() }) }),
    },
    'sessions.list': { params: z.object({}), result: RemoteSessions },
    'projects.list': { params: z.object({}), result: z.object({ projects: z.array(RemoteProject) }) },
    /**
     * A page of a transcript. Without `before` or `after`, the last `limit` messages. `after` resumes from the last
     * message the phone has: `reset` says that message is gone (a rewind or compaction) and `messages` is the last page.
     */
    'transcript.get': {
      params: z.object({
        sessionId: SessionId,
        before: z.string().max(200).optional(),
        after: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(REMOTE_PAGE_LIMIT).default(50),
      }),
      result: z.object({ messages: z.array(RemoteMessage), hasMore: z.boolean(), reset: z.boolean() }),
    },
    /** From now on, `transcript.updated` for this session (one at a time per phone; watching another stops this one). */
    'transcript.watch': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'transcript.unwatch': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Sends a prompt, or queues it while Claude is working (`mode`, as on the Mac). No attachments. */
    'session.send': {
      params: z.object({ sessionId: SessionId, text: Prompt, mode: SendMode.default('queue') }),
      result: z.object({ queued: z.boolean() }),
    },
    'session.queue.remove': { params: z.object({ sessionId: SessionId, id: z.string().min(1).max(200) }), result: z.object({}) },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Answers a permission prompt, question or plan. NOT_FOUND when it was already answered. */
    'session.respond': { params: z.object({ requestId: z.string().min(1).max(200), decision: PermissionDecision }), result: z.object({}) },
    /** A new session in a project Switchboard knows, with the project's defaults for model, effort and mode. */
    'session.create': { params: z.object({ projectId: ProjectId, prompt: Prompt }), result: z.object({ sessionId: z.string() }) },
  },
  events: {
    'sessions.changed': RemoteSessions,
    'transcript.updated': RemoteTranscriptUpdate,
    'session.stream': StreamDelta,
    'upNext.changed': z.object({ sessionId: z.string(), queue: z.array(QueuedMessage) }),
  },
} as const satisfies ContractShape;
export type RemoteContract = typeof remoteContract;

/** The only request a pairing phone can make, once it proved it scanned the QR code. */
export const remotePairContract = {
  requests: {
    /** Resolves once you click Allow on the Mac (fails with DENIED on Deny, a timeout or a closed dialog). */
    'pair.request': {
      params: z.object({ name: DeviceName }),
      result: z.object({ deviceId: z.string() }),
    },
  },
  events: {},
} as const satisfies ContractShape;
export type RemotePairContract = typeof remotePairContract;

// ---------------------------------------------------------------------------
// Settings › Remote, between the engine and the app's windows
// ---------------------------------------------------------------------------

/** The port Remote listens on, on this computer only (`127.0.0.1`); the tunnel forwards to it. */
export const REMOTE_DEFAULT_PORT = 47615;

/**
 * Where the remote app lives: one fixed HTTPS address, so a phone pairs once whatever the tunnel's address is, and
 * the app's code comes from Switchboard's own site rather than from the tunnel. The engine only accepts sockets
 * from this origin.
 */
export const REMOTE_APP_URL = 'https://switchboard.struyfconsulting.com/remote/';

/**
 * How a phone reaches this computer from anywhere:
 *  - `cloudflare`: a Cloudflare quick tunnel (`cloudflared`, no account; a new address each time it starts);
 *  - `ngrok`: an ngrok tunnel (an account; a fixed address with your ngrok domain);
 *  - `tailscale`: `tailscale serve`, only for your own devices on your tailnet (HTTPS certificates must be on);
 *  - `custom`: a tunnel or proxy you run yourself, forwarding your `https://` address to Remote's port.
 */
export const RemoteTunnel = z.enum(['cloudflare', 'ngrok', 'tailscale', 'custom']);
export type RemoteTunnel = z.infer<typeof RemoteTunnel>;

/** An `https://` origin, without a path. */
const HttpsOrigin = z.string().max(300).regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/);

export const RemoteSettings = z.object({
  /** Allow access from my phone. */
  enabled: z.boolean(),
  tunnel: RemoteTunnel,
  /** `custom`: the public address that forwards to Remote's port. */
  customUrl: HttpsOrigin.nullable(),
  /** `ngrok`: your ngrok domain, for an address that doesn't change (`name.ngrok-free.app`). */
  ngrokDomain: z.string().max(253).regex(/^[A-Za-z0-9.-]+$/).nullable(),
  port: z.number().int().min(1024).max(65535),
});
export type RemoteSettings = z.infer<typeof RemoteSettings>;

export const RemoteStatus = z.object({
  /** False when this build doesn't offer Remote. */
  available: z.boolean(),
  settings: RemoteSettings,
  /** The remote app, for the QR codes. */
  appUrl: z.string(),
  /** The engine's public address while the tunnel runs (`https://…`). */
  address: z.string().nullable(),
  tunnel: z.object({
    state: z.enum(['off', 'starting', 'running', 'failed']),
    /** Why it failed, in the tool's own words when it said something. */
    message: z.string().nullable(),
  }),
  /** Which tunnel tools this computer has (`custom` needs none). */
  tools: z.object({ cloudflare: z.boolean(), ngrok: z.boolean(), tailscale: z.boolean() }),
  /** Why Remote isn't running when it should. */
  problem: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('port-in-use'), port: z.number() }),
      z.object({ kind: z.literal('tool-missing'), tunnel: RemoteTunnel }),
      z.object({ kind: z.literal('failed'), message: z.string() }),
    ])
    .nullable(),
  devices: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.number(), lastSeenAt: z.number().nullable() })),
  connections: z.array(z.object({ deviceId: z.string(), name: z.string(), since: z.number() })),
  pairing: z.object({
    offer: z.object({ expiresAt: z.number() }).nullable(),
    request: z.object({ id: z.string(), name: z.string(), code: z.string(), expiresAt: z.number() }).nullable(),
    locked: z.boolean(),
  }),
});
export type RemoteStatus = z.infer<typeof RemoteStatus>;
