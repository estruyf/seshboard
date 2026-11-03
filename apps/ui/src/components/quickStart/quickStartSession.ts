import type { ClaudeProfile, ImageAttachment, Preferences, ProjectInfo } from '@seshboard/protocol/client';
import type { EngineClient } from '../../engine/connection.ts';
import { questionStartingChoices, QUESTION_DEFAULTS_KEY, readQuestionChoices } from '../../lib/questions.ts';
import { passFocusGate } from '../../state/focusGate.ts';
import { trustRepository } from '../../state/repoTrust.ts';
import { globalChoices, LAST_MODE_KEY, layeredDefaults, newSessionChoices, readLastMode, type Choices } from '../newSession/choices.ts';
import { startNewSession, type StartOutcome } from '../newSession/startSession.ts';

/**
 * Starting a session from outside the main window, in the background: quick start (the global shortcut's panel) and
 * the menu bar's new work. One project, one prompt, the project's defaults unless changed, and one engine call
 * (`session.create`, through `startNewSession` with the focus limit's gate and the trust question). A deep link
 * (`seshboard://start?project=…&prompt=…`) could start one the same way.
 */

/** What starting in a folder needs to know first: whether it is there, the options it starts with, and its git state. */
export interface QuickSetup {
  exists: boolean;
  choices: Choices;
  isGitRepo: boolean;
  currentBranch: string | null;
  checkedOutElsewhere: string[];
}

/** The profile a project starts with: its own, else the default. */
export function projectProfile(project: ProjectInfo | undefined, profiles: readonly ClaudeProfile[], defaultId: string): string {
  return project?.profileId && profiles.some((p) => p.id === project.profileId) ? project.profileId : defaultId;
}

/**
 * The options a new session in `root` starts with, as New session would: a quick question's own, else the project's
 * and its profile's defaults over Settings' (with Remember last's mode). And whether the folder is there, with its git state.
 */
export async function quickSetup(
  client: EngineClient,
  input: { root: string; project: ProjectInfo | undefined; profile: ClaudeProfile | undefined; prefs: Preferences; question: boolean },
): Promise<QuickSetup> {
  const inspection = await client.call('projects.inspect', { path: input.root });
  let choices: Choices;
  if (input.question) {
    const stored = await client.call('appState.get', { key: QUESTION_DEFAULTS_KEY }).then(({ value }) => value, () => null);
    choices = questionStartingChoices(readQuestionChoices(stored));
  } else {
    const defaults = layeredDefaults(input.project?.added ? input.project.defaults : null, input.profile?.defaults);
    const last = readLastMode(await client.call('appState.get', { key: LAST_MODE_KEY }).then(({ value }) => value, () => null));
    choices = newSessionChoices(defaults, input.prefs.newSessionMode, last, globalChoices(input.prefs));
  }
  const git = inspection.exists && inspection.isGitRepo && !input.question ? await client.call('git.branches', { cwd: input.root }).catch(() => null) : null;
  return {
    exists: inspection.exists,
    choices,
    isGitRepo: !!git,
    currentBranch: git?.current ?? null,
    checkedOutElsewhere: git?.checkedOutElsewhere ?? [],
  };
}

/** What a quick start sends. `provider`: the profile is another provider's (GitHub Copilot), which picks its own model. */
export interface QuickStartRequest {
  root: string;
  prompt: string;
  attachments?: ImageAttachment[];
  choices: Choices;
  worktree: boolean;
  profileId: string;
  setup: Pick<QuickSetup, 'currentBranch' | 'checkedOutElsewhere'>;
  autoEnabled: boolean;
  provider?: boolean;
  /** At the focus limit the gate can park the prompt on the queue instead. */
  saveForLater?: () => Promise<unknown>;
}

/** Starts the session in the background: nothing in the main window moves. It shows there (and on the phone) from the engine. */
export function startQuickSession(client: EngineClient, request: QuickStartRequest): Promise<StartOutcome> {
  return startNewSession(
    {
      cwd: request.root,
      prompt: request.prompt,
      attachments: request.attachments ?? [],
      choices: request.choices,
      worktree: request.worktree,
      currentBranch: request.setup.currentBranch,
      checkedOutElsewhere: request.setup.checkedOutElsewhere,
      profileId: request.profileId,
      autoEnabled: request.autoEnabled,
      saveForLater: request.saveForLater,
      provider: request.provider ? { model: null, permissionMode: request.choices.permissionMode } : null,
    },
    {
      createSession: (params) => client.call('session.create', params),
      gate: passFocusGate,
      trust: (needed) => trustRepository(client, needed),
      addProject: async () => {},
      // The main window shows the session from the engine; nothing waits here for its transcript.
      keep: () => {},
      open: () => {},
    },
  );
}
