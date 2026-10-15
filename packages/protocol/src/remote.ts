import { z } from 'zod';
import type { ContractShape } from './rpc.ts';
import { CompanionStatus } from './companion.ts';
import { CatchUp } from './catchUp.ts';
import { ChangedFile } from './git.ts';
import { Effort, ImageAttachment, ModelOption, PermissionDecision, PermissionMode, QueuedMessage, SendMode, StreamDelta } from './host.ts';
import { ProfileColor } from './profiles.ts';
import { MAX_PROMPT_LENGTH } from './promptConstants.ts';
import { REMOTE_IMAGE_BYTES, REMOTE_MAX_IMAGES } from './remoteConstants.ts';

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
const ProfileId = z.string().min(1).max(100);
/** The name a phone gives itself while pairing ("Elio's iPhone"). */
export const DeviceName = z.string().trim().min(1).max(60);

/** A Claude profile as a session row shows it: its colour and name. */
export const RemoteSessionProfile = z.object({ id: z.string(), name: z.string(), color: ProfileColor });
export type RemoteSessionProfile = z.infer<typeof RemoteSessionProfile>;

export const RemoteSession = z.object({
  id: z.string(),
  title: z.string(),
  projectId: ProjectId,
  projectName: z.string(),
  branch: z.string().nullable(),
  status: CompanionStatus,
  updatedAt: z.number(),
  /** Finished since you last looked, on any device: the title shows in bold. */
  unread: z.boolean(),
  pinned: z.boolean(),
  /** While it runs in Switchboard: its model and permission mode, for the chips in the message box. */
  model: z.string().nullable(),
  permissionMode: PermissionMode.nullable(),
  /** The Claude profile (login) it runs with; null while there is only one profile (the app shows none then), or not known. */
  profile: RemoteSessionProfile.nullable(),
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

/**
 * The permission modes a phone may pick. The others (don't ask, bypass permissions) let Claude run anything without
 * asking: they are only offered on the computer.
 */
export const RemotePermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto']);
export type RemotePermissionMode = z.infer<typeof RemotePermissionMode>;

/** What a phone may choose for a new session; anything left out is the project's default, then its profile's. */
export const RemoteSessionOptions = z.object({
  /** The Claude profile to run with, for this session only; left out: the project's, else the default. */
  profileId: ProfileId.optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  effort: Effort.nullable().optional(),
  permissionMode: RemotePermissionMode.optional(),
  /** In a new worktree (true) or the project's folder (false). */
  worktree: z.boolean().optional(),
});
export type RemoteSessionOptions = z.infer<typeof RemoteSessionOptions>;

/** A project's or a profile's defaults for new sessions (null: not set there). */
export const RemoteDefaults = z.object({ model: z.string().nullable(), effort: Effort.nullable(), permissionMode: PermissionMode.nullable(), worktree: z.boolean().nullable() });
export type RemoteDefaults = z.infer<typeof RemoteDefaults>;

/** A Claude profile (login) as a phone knows it: its name and colour, never its folder or account. */
export const RemoteProfile = z.object({ id: z.string(), name: z.string(), color: ProfileColor, defaults: RemoteDefaults });
export type RemoteProfile = z.infer<typeof RemoteProfile>;

/**
 * New session's choices: the models, efforts and profiles, and each project's profile and defaults. A new session
 * takes the project's defaults, then its profile's, then Switchboard's own.
 */
export const RemoteOptions = z.object({
  models: z.array(ModelOption.pick({ value: true, displayName: true, description: true, supportsEffort: true })),
  efforts: z.array(Effort),
  modes: z.array(RemotePermissionMode),
  profiles: z.array(RemoteProfile),
  /** The profile of projects without one of their own. */
  defaultProfileId: z.string(),
  projects: z.array(
    z.object({
      id: ProjectId,
      /** The project's own profile (null: the default). */
      profileId: z.string().nullable(),
      defaults: RemoteDefaults,
    }),
  ),
});
export type RemoteOptions = z.infer<typeof RemoteOptions>;

/** A changed file in the session's checkout. */
export const RemoteChangedFile = ChangedFile.pick({ path: true, status: true, additions: true, deletions: true });
export type RemoteChangedFile = z.infer<typeof RemoteChangedFile>;

/** A browser's push subscription (`PushSubscription.toJSON()`), checked by the engine against the known push services. */
export const RemotePushSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2_000),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/) }),
});
export type RemotePushSubscription = z.infer<typeof RemotePushSubscription>;

/** An image a phone sends with a message: the app's attachment, smaller. */
export const RemoteImage = ImageAttachment.extend({ data: z.string().min(1).max(REMOTE_IMAGE_BYTES) });
export type RemoteImage = z.infer<typeof RemoteImage>;

/** The most lines `changes.diff` returns. */
export const REMOTE_DIFF_LINES = 2_000;

/** The most messages one `transcript.get` returns. */
export const REMOTE_PAGE_LIMIT = 200;

export const remoteContract = {
  requests: {
    /** The first request on a connection, after the handshake. */
    hello: {
      params: z.object({ client: z.object({ version: z.string().max(50) }) }),
      result: z.object({
        app: z.object({ version: z.string() }),
        device: z.object({ id: z.string(), name: z.string() }),
        /** What people call the computer ("Elio's iMac"), for the connection chip and the offline help. */
        computer: z.object({ name: z.string() }),
      }),
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
    /** Sends a prompt, or queues it while Claude is working (`mode`, as on the Mac), with images pasted, dropped or photographed. */
    'session.send': {
      params: z.object({ sessionId: SessionId, text: Prompt, mode: SendMode.default('queue'), images: z.array(RemoteImage).max(REMOTE_MAX_IMAGES).default([]) }),
      result: z.object({ queued: z.boolean() }),
    },
    'session.queue.remove': { params: z.object({ sessionId: SessionId, id: z.string().min(1).max(200) }), result: z.object({}) },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Answers a permission prompt, question or plan. NOT_FOUND when it was already answered. */
    'session.respond': { params: z.object({ requestId: z.string().min(1).max(200), decision: PermissionDecision }), result: z.object({}) },
    /** A new session in a project Switchboard knows. What it leaves out of the options is the project's default. */
    'session.create': { params: z.object({ projectId: ProjectId, prompt: Prompt }).extend(RemoteSessionOptions.shape), result: z.object({ sessionId: z.string() }) },
    /** Puts a prompt in Switchboard's queue (Later) for a project, to start when you choose. */
    'later.add': { params: z.object({ projectId: ProjectId, prompt: Prompt }).extend(RemoteSessionOptions.shape), result: z.object({ id: z.string() }) },
    /** Marks a session read, as opening it on the computer does. */
    'session.markRead': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Pins or archives a session; an archived one leaves the phone's list. */
    'session.setFlags': { params: z.object({ sessionId: SessionId, pinned: z.boolean().optional(), archived: z.boolean().optional() }), result: z.object({}) },
    /** The model of a running session (null: the default). */
    'session.setModel': { params: z.object({ sessionId: SessionId, model: z.string().min(1).max(200).nullable() }), result: z.object({}) },
    'session.setPermissionMode': { params: z.object({ sessionId: SessionId, mode: RemotePermissionMode }), result: z.object({}) },
    /** New session's choices. */
    'options.get': { params: z.object({}), result: RemoteOptions },
    /** The catch-up of a session's last turn, without paths outside its project. */
    'catchup.get': { params: z.object({ sessionId: SessionId }), result: z.object({ catchUp: CatchUp.nullable() }) },
    /** What changed in the session's checkout (its worktree when it has one), not committed yet. */
    'changes.get': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ branch: z.string().nullable(), files: z.array(RemoteChangedFile), error: z.string().nullable() }),
    },
    /** One changed file's unified diff, at most `REMOTE_DIFF_LINES` lines. Only files `changes.get` lists. */
    'changes.diff': { params: z.object({ sessionId: SessionId, path: z.string().min(1).max(4096) }), result: z.object({ diff: z.string(), truncated: z.boolean() }) },
    /**
     * Commits every change in the session's checkout, without a terminal. A failed commit (a hook said no) is not an
     * error: `output` has the last lines of what it printed. It never pushes.
     */
    'changes.commit': {
      params: z.object({ sessionId: SessionId, message: z.string().trim().min(1).max(20_000) }),
      result: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), sha: z.string() }), z.object({ ok: z.literal(false), output: z.string() })]),
    },
    /** The engine's VAPID public key, for `pushManager.subscribe` (made the first time a phone asks). */
    'push.key': { params: z.object({}), result: z.object({ publicKey: z.string() }) },
    /** Push to this device when a session needs you, finishes, or both; replaces what it had. */
    'push.subscribe': {
      params: z.object({ subscription: RemotePushSubscription, needsYou: z.boolean(), finished: z.boolean() }),
      result: z.object({}),
    },
    'push.unsubscribe': { params: z.object({}), result: z.object({}) },
    /** Whether the app is on this device's screen now: no push while it is. Sent after hello and on each change. */
    'device.visibility': { params: z.object({ visible: z.boolean() }), result: z.object({}) },
  },
  events: {
    'sessions.changed': RemoteSessions,
    'transcript.updated': RemoteTranscriptUpdate,
    'session.stream': StreamDelta,
    'upNext.changed': z.object({ sessionId: z.string(), queue: z.array(QueuedMessage) }),
    /** The catch-up of the session the phone watches changed. */
    'catchup.changed': z.object({ sessionId: z.string(), catchUp: CatchUp.nullable() }),
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
