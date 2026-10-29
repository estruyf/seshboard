import { AUTO_MODEL, worktreeRequestBase, type GithubOrigin, type ImageAttachment, type PermissionMode, type WorktreeBranchBase } from '@seshboard/protocol/client';
import { randomWorktreeName } from '../../lib/modes.ts';
import type { DraftForm } from '../../state/drafts.ts';
import type { GateOutcome } from '../../state/focusGate.ts';
import { trustNeededOf, type TrustNeeded } from '../../state/repoTrust.ts';
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
  /** Branches checked out in another worktree (`git.branches`), which git won't check out here. */
  checkedOutElsewhere?: readonly string[];
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
  /**
   * Filled in from an issue or pull request: kept with the session (`origin`). For a pull request, the worktree starts
   * from its branch (`worktreeFrom`), or Current checkout checks it out first (`checkoutPullRequest`).
   */
  github?: { origin: GithubOrigin; worktreeFrom?: WorktreeBranchBase; checkoutPullRequest?: { number: number; repo: string } };
}

/** What starting needs from the app; the view and the palette pass the real ones, tests fake them. */
export interface StartDeps {
  createSession(params: SessionCreateParams): Promise<{ sessionId: string }>;
  /** The focus limit's gate (`passFocusGate`). */
  gate(options: { saveForLater?: () => Promise<unknown> }): Promise<GateOutcome>;
  addProject(path: string): Promise<void>;
  /** Keeps the prompt until the session has a transcript (`keepFirstPrompt` in the drafts store). */
  keep(sessionId: string, first: FirstPromptStart): void;
  /** Shows the new session. */
  open(sessionId: string): void;
  /**
   * Asks the trust question for a cloned repository the engine won't start in yet (`trustRepository`): true once it
   * is trusted. Without it, such a start fails with the engine's error.
   */
  trust?(needed: TrustNeeded): Promise<boolean>;
}

/** A new session's first prompt, and what it takes to start it again from New session. */
export interface FirstPromptStart {
  cwd: string;
  prompt: string;
  attachments: ImageAttachment[];
  form: DraftForm;
}

/** What `keep` gets: the prompt as sent, with New session's choices as they were. */
export function firstPromptOf(start: NewSessionStart): FirstPromptStart {
  return {
    cwd: start.cwd,
    prompt: start.prompt,
    attachments: start.attachments ?? [],
    form: { choices: { ...start.choices, workspace: start.worktree ? 'worktree' : 'current' }, profileId: start.profileId },
  };
}

export interface SessionCreateParams {
  cwd: string;
  prompt: string;
  attachments: ImageAttachment[];
  model: string | null;
  permissionMode: PermissionMode;
  effort: Exclude<Choices['effort'], ''> | null;
  worktree: { name: string; baseRef: 'fresh' | 'head' | WorktreeBranchBase } | null;
  checkoutBranch: string | null;
  profileId: string;
  checkoutPullRequest?: { number: number; repo: string };
  github?: GithubOrigin;
}

export type StartOutcome = { kind: 'started'; sessionId: string } | { kind: 'saved' } | { kind: 'stopped' };

/** The branch to check out before starting: one other than the current, and never with a worktree. */
export function checkoutBranchFor(choices: Choices, worktree: boolean, currentBranch: string | null): string | null {
  return !worktree && choices.branch && choices.branch !== currentBranch ? choices.branch : null;
}

/** What a branch picker says under a branch that is checked out in another worktree, as a session's branch menu does. */
export const ELSEWHERE_NOTE = 'Checked out in another worktree';

/**
 * Why the session can't start on the branch it would check out: another worktree has it (Claude Code's
 * `.claude/worktrees/*`, for one), and git refuses with "already checked out". Null when nothing stands in the way.
 * Starting in a new worktree checks nothing out, so it is never blocked.
 */
export function branchBlocked(checkoutBranch: string | null, checkedOutElsewhere: readonly string[] | undefined): string | null {
  if (!checkoutBranch || !checkedOutElsewhere?.includes(checkoutBranch)) return null;
  return `${checkoutBranch} is checked out in another worktree. Pick another branch, or start in a new worktree.`;
}

/** What `session.create` gets: a worktree with a made-up name unless you named it. */
export function sessionCreateParams(start: NewSessionStart): SessionCreateParams {
  const { choices, github } = start;
  // A pull request: its own branch, in a new worktree or checked out here; never another branch as well.
  const fromPr = github && (github.worktreeFrom || github.checkoutPullRequest);
  return {
    ...(github ? { github: github.origin } : {}),
    ...(github?.checkoutPullRequest && !start.worktree ? { checkoutPullRequest: github.checkoutPullRequest } : {}),
    cwd: start.cwd,
    prompt: start.prompt,
    attachments: start.attachments ?? [],
    // The engine routes Auto once the session is open; with Auto off it is the default model.
    model: choices.model === AUTO_MODEL && start.autoEnabled === false ? null : choices.model || null,
    // A link never starts a session in a mode that skips permission prompts.
    permissionMode: start.fromLink ? linkPermissionMode(choices.permissionMode) : choices.permissionMode,
    effort: choices.effort || null,
    worktree: start.worktree ? { name: start.worktreeName || randomWorktreeName(), baseRef: (start.worktree && github?.worktreeFrom) || worktreeRequestBase(choices.baseRef) } : null,
    checkoutBranch: fromPr ? null : checkoutBranchFor(choices, start.worktree, start.currentBranch),
    profileId: start.profileId,
  };
}

/** Claude Code can be warmed up for the folder while you type: only for this checkout as it is (no worktree, no branch to switch to). */
export const shouldPrewarm = (choices: Pick<Choices, 'workspace' | 'branch'>) => choices.workspace === 'current' && !choices.branch;

/**
 * Starts a new session the one way every New session does: the focus limit's gate first (which may
 * ask, or park the prompt for later instead), then `session.create`, then the folder joins your projects when asked,
 * and the new session opens. Nothing starts when the gate says stop. On Auto the session opens at once and says Auto
 * is choosing; the engine sends your message once it has picked. The prompt is kept until the session has a
 * transcript, so a Claude Code that fails before it writes one (no login) doesn't lose it.
 */
export async function startNewSession(start: NewSessionStart, deps: StartDeps): Promise<StartOutcome> {
  // Said before anything starts, instead of git's "fatal: '…' is already checked out at '…'".
  const blocked = branchBlocked(checkoutBranchFor(start.choices, start.worktree, start.currentBranch), start.checkedOutElsewhere);
  if (blocked) throw new Error(blocked);
  if (!start.skipGate) {
    const outcome = await deps.gate({ saveForLater: start.saveForLater });
    if (outcome === 'stop') return { kind: 'stopped' };
    if (outcome === 'saved') return { kind: 'saved' };
  }
  const params = sessionCreateParams(start);
  let created: { sessionId: string };
  try {
    created = await deps.createSession(params);
  } catch (error) {
    // A cloned repository's hooks and MCP servers run only once the person said so, whichever way the start came.
    const needed = trustNeededOf(error);
    if (!needed || !deps.trust) throw error;
    if (!(await deps.trust(needed))) return { kind: 'stopped' };
    created = await deps.createSession(params);
  }
  const { sessionId } = created;
  deps.keep(sessionId, firstPromptOf(start));
  if (start.addProject && !start.fromLink) await deps.addProject(start.cwd).catch(() => {});
  deps.open(sessionId);
  return { kind: 'started', sessionId };
}
