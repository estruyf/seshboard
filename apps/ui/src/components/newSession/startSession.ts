import { AUTO_MODEL, type AutoTier, type ImageAttachment, type PermissionMode, type RouteResult } from '@switchboard/protocol/client';
import { randomWorktreeName } from '../../lib/modes.ts';
import type { GateOutcome } from '../../state/focusGate.ts';
import { linkPermissionMode, type Choices } from './choices.ts';

/** A new session as New session (the view, or the palette's prompt step) is about to start it. */
export interface NewSessionStart {
  cwd: string;
  prompt: string;
  attachments?: ImageAttachment[];
  choices: Choices;
  /** It runs in a new worktree (asked for, in a git repository). */
  worktree: boolean;
  /** The worktree's name as typed; empty or missing: a made-up three-word name. */
  worktreeName?: string;
  /** The branch checked out now: choosing it checks nothing out. */
  currentBranch: string | null;
  profileId: string;
  /** Started by an `autostart` link: never in a mode that skips permission prompts, never added as a project. */
  fromLink?: boolean;
  /** The focus limit already said yes (Start anyway). */
  skipGate?: boolean;
  /** Add the folder to your projects once the session has started. */
  addProject?: boolean;
  /** Parks the prompt on the Later list, when the focus limit's gate offers that instead. */
  saveForLater?: () => Promise<unknown>;
  /** Auto model is on in Settings. Off, a model of Auto starts on the default model, without routing. */
  autoEnabled?: boolean;
}

/** What starting needs from the app; the view and the palette pass the real ones, tests fake them. */
export interface StartDeps {
  createSession(params: SessionCreateParams): Promise<{ sessionId: string }>;
  /** The focus limit's gate (`passFocusGate`). */
  gate(options: { saveForLater?: () => Promise<unknown> }): Promise<GateOutcome>;
  addProject(path: string): Promise<void>;
  /** Shows the new session. */
  open(sessionId: string): void;
  /**
   * Auto model's routing (`model.route`), while Start says "Choosing a model…". Null: stopped with Esc, and
   * nothing starts (the prompt stays).
   */
  route?(params: { profileId: string; prompt: string; imageCount: number }): Promise<RouteResult | null>;
}

export interface SessionCreateParams {
  cwd: string;
  prompt: string;
  attachments: ImageAttachment[];
  model: string | null;
  permissionMode: PermissionMode;
  effort: Exclude<Choices['effort'], ''> | null;
  worktree: { name: string; baseRef: Choices['baseRef'] } | null;
  checkoutBranch: string | null;
  profileId: string;
  /** What Auto picked (or why it couldn't), when the model was Auto. */
  autoPick: { routeId: string | null; model: AutoTier | null; reason: string; tokens: number; allowed: AutoTier[] } | null;
}

export type StartOutcome = { kind: 'started'; sessionId: string } | { kind: 'saved' } | { kind: 'stopped' };

/** The branch to check out before starting: one other than the current, and never with a worktree. */
export function checkoutBranchFor(choices: Choices, worktree: boolean, currentBranch: string | null): string | null {
  return !worktree && choices.branch && choices.branch !== currentBranch ? choices.branch : null;
}

/** What `session.create` gets: a worktree with a made-up name unless you named it. */
export function sessionCreateParams(start: NewSessionStart): SessionCreateParams {
  const { choices } = start;
  return {
    cwd: start.cwd,
    prompt: start.prompt,
    attachments: start.attachments ?? [],
    // Auto is resolved by `startNewSession` (routing); here it is the default model until then.
    model: choices.model === AUTO_MODEL ? null : choices.model || null,
    // A link never starts a session in a mode that skips permission prompts.
    permissionMode: start.fromLink ? linkPermissionMode(choices.permissionMode) : choices.permissionMode,
    effort: choices.effort || null,
    worktree: start.worktree ? { name: start.worktreeName || randomWorktreeName(), baseRef: choices.baseRef } : null,
    checkoutBranch: checkoutBranchFor(choices, start.worktree, start.currentBranch),
    profileId: start.profileId,
    autoPick: null,
  };
}

/** Whether starting routes first: the model is Auto, Auto is on, and there is a router. */
export const routesFirst = (start: Pick<NewSessionStart, 'choices' | 'autoEnabled'>, deps: Pick<StartDeps, 'route'>) =>
  start.choices.model === AUTO_MODEL && start.autoEnabled !== false && !!deps.route;

/** Claude Code can be warmed up for the folder while you type: only for this checkout as it is (no worktree, no branch to switch to). */
export const shouldPrewarm = (choices: Pick<Choices, 'workspace' | 'branch'>) => choices.workspace === 'current' && !choices.branch;

/**
 * Starts a new session the one way every New session does: the focus limit's gate first (which may
 * ask, or park the prompt for later instead), then Auto model's routing when the model is Auto, then `session.create`, then the folder joins your
 * projects when asked, and the new session opens. Nothing starts when the gate says stop.
 */
export async function startNewSession(start: NewSessionStart, deps: StartDeps): Promise<StartOutcome> {
  if (!start.skipGate) {
    const outcome = await deps.gate({ saveForLater: start.saveForLater });
    if (outcome === 'stop') return { kind: 'stopped' };
    if (outcome === 'saved') return { kind: 'saved' };
  }
  const params = sessionCreateParams(start);
  if (routesFirst(start, deps)) {
    const route = await deps.route!({ profileId: start.profileId, prompt: start.prompt, imageCount: params.attachments.length });
    if (!route) return { kind: 'stopped' };
    // A failure starts on the default model; the session says why.
    params.model = route.ok ? route.model : null;
    params.autoPick = { routeId: route.routeId, model: route.ok ? route.model : null, reason: route.reason, tokens: route.tokens, allowed: route.allowed };
  }
  const { sessionId } = await deps.createSession(params);
  if (start.addProject && !start.fromLink) await deps.addProject(start.cwd).catch(() => {});
  deps.open(sessionId);
  return { kind: 'started', sessionId };
}
