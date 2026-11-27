import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import type { ContractShape } from './rpc.ts';
import { ImageAttachment, PermissionDecision, PermissionRequest } from './host.ts';
import { MAX_CONTEXT_ITEMS } from './companionConstants.ts';
import { CompanionContextItem } from './context.ts';

/**
 * The companion contract: what the VS Code companion and the browser extension ask the engine over its Unix socket,
 * and what the engine tells them. The engine validates every message against it; see docs/vscode-companion.md and
 * docs/browser-extension.md.
 */

const SessionId = z.string().min(1).max(200);
/** Workspace folders: sessions in one of them (or whose folder holds one of them) are listed. */
const Folders = z.array(AbsolutePath).max(50);

/** How a session is doing, as the sidebar shows it, most urgent first. */
export const CompanionStatus = z.enum(['needs-you', 'working', 'background', 'error', 'unread', 'idle', 'stopped']);
export type CompanionStatus = z.infer<typeof CompanionStatus>;

export const CompanionSession = z.object({
  id: z.string(),
  title: z.string(),
  cwd: z.string().nullable(),
  /** The repository (worktrees fold into it), or the folder outside git. */
  projectRoot: z.string(),
  branch: z.string().nullable(),
  status: CompanionStatus,
  updatedAt: z.number(),
  /** Started, forked or continued in Seshboard. */
  inApp: z.boolean(),
});
export type CompanionSession = z.infer<typeof CompanionSession>;

/** Where context goes: a session, or New session on a folder. */
export const CompanionTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: SessionId }),
  z.object({ kind: z.literal('new'), cwd: AbsolutePath }),
]);
export type CompanionTarget = z.infer<typeof CompanionTarget>;

/** The sessions for some folders, and the one on screen in Seshboard (wherever it is). */
export const CompanionSessions = z.object({
  sessions: z.array(CompanionSession),
  focused: CompanionSession.nullable(),
  /** Seshboard windows connected to the engine; without one, context has nowhere to show. */
  windows: z.number(),
  /**
   * What the listed sessions are waiting on you for (a permission, a question, a plan), oldest first. Left out by
   * engines from before the extension could answer them.
   */
  prompts: z.array(PermissionRequest).optional(),
});
export type CompanionSessions = z.infer<typeof CompanionSessions>;

/** The most pictures one `context.add` takes. */
export const MAX_COMPANION_IMAGES = 4;

/** A project you can start a session in, for the browser extension's list. */
export const CompanionProject = z.object({ root: z.string(), name: z.string() });
export type CompanionProject = z.infer<typeof CompanionProject>;

export const companionContract = {
  requests: {
    /** The first message on a connection; anything else, or a wrong token, closes it. */
    hello: {
      params: z.object({
        token: z.string().min(1).max(200),
        protocol: z.number().int(),
        client: z.object({ name: z.string().max(100), version: z.string().max(50) }),
      }),
      result: z.object({ protocol: z.number(), app: z.object({ version: z.string() }) }),
    },
    /** Sessions in these folders (most urgent, then most recent first), and the focused one. */
    'sessions.list': {
      params: z.object({ folders: Folders, limit: z.number().int().min(1).max(200).default(50) }),
      result: CompanionSessions,
    },
    /** From now on, `sessions.changed` with the sessions in these folders (replaces earlier folders). */
    'sessions.watch': { params: z.object({ folders: Folders }), result: z.object({}) },
    /**
     * Adds context to a session's message box, or to New session on a folder. Nothing is sent to Claude: it shows as
     * chips until you press send. Resolves once a Seshboard window has added them (NO_WINDOW without one).
     * `reveal` brings Seshboard to the front on that session.
     */
    'context.add': {
      params: z
        .object({
          target: CompanionTarget,
          items: z.array(CompanionContextItem).max(MAX_CONTEXT_ITEMS).default([]),
          /** Pictures for the message box, as Attach images adds them (the browser extension's screenshot). */
          images: z.array(ImageAttachment).max(MAX_COMPANION_IMAGES).optional(),
          reveal: z.boolean().default(true),
        })
        .refine((p) => p.items.length > 0 || (p.images?.length ?? 0) > 0, 'Send at least one item or image'),
      result: z.object({}),
    },
    /** Shows a session in Seshboard and brings it to the front (the status bar item). */
    'session.reveal': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Answers one of `prompts`, as its card in Seshboard would. `acceptEdits` switches the session to accepting
     * edits once a plan is approved. Fails with NOT_FOUND when it was already answered (in Seshboard, say).
     */
    'prompt.respond': {
      params: z.object({ requestId: z.string().min(1).max(200), decision: PermissionDecision, acceptEdits: z.boolean().default(false) }),
      result: z.object({}),
    },
    /**
     * Seshboard's projects (most recently active first), for the browser extension. With `url`, `matched` is the
     * project whose GitHub remote that page is on (`github.com/owner/name/…`), or null. Engines from before the
     * browser extension answer METHOD_NOT_FOUND.
     */
    'projects.list': {
      params: z.object({ url: z.string().max(2000).optional() }),
      result: z.object({ projects: z.array(CompanionProject), matched: z.string().nullable() }),
    },
  },
  events: {
    /** The watched folders' sessions changed (status, title, new ones). */
    'sessions.changed': CompanionSessions,
  },
} as const satisfies ContractShape;

export type CompanionContract = typeof companionContract;
