/**
 * The agents Seshboard reads sessions from. Claude Code is always on; the others stay hidden until a profile of theirs
 * is added in Settings › Profiles. Kept free of zod for the renderer.
 */
export const SESSION_PROVIDERS = ['claude', 'copilot'] as const;
export type SessionProvider = (typeof SESSION_PROVIDERS)[number];

/** The providers besides Claude Code, which can be allowed or not. */
export const OPTIONAL_PROVIDERS = ['copilot'] as const satisfies readonly SessionProvider[];
export type OptionalProvider = (typeof OPTIONAL_PROVIDERS)[number];

export const PROVIDER_NAMES: Record<SessionProvider, string> = { claude: 'Claude Code', copilot: 'GitHub Copilot' };

/** The short name in copy around the message box ("What should Copilot work on?"). */
export const PROVIDER_SHORT_NAMES: Record<SessionProvider, string> = { claude: 'Claude', copilot: 'Copilot' };

/**
 * Claude Code's own features another provider may or may not have yet: in a session (⋯) and in New session. A
 * provider lists the ones it has (`ProviderInfo.supports`); the rest say "Claude Code only, for now", and the list
 * shrinks as a provider gets them.
 */
export const PROVIDER_FEATURES = ['fork', 'rewind', 'rename', 'ask', 'worktree', 'branch', 'pipeline', 'later', 'schedule'] as const;
export type ProviderFeature = (typeof PROVIDER_FEATURES)[number];

/** The session actions among them, as the ⋯ menu names them. */
export const SESSION_FEATURE_LABELS: Partial<Record<ProviderFeature, string>> = { fork: 'Fork', rewind: 'Rewind', rename: 'Rename', ask: 'Ask about this session' };

/** "A, B and C" (no Oxford comma, as the app's copy). */
export const joinWords = (words: readonly string[]): string => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * The ⋯ menu's faint line in another provider's session: the session actions it doesn't have yet. Null when it has
 * them all.
 */
export function claudeOnlyLine(supports: readonly ProviderFeature[]): string | null {
  const missing = (Object.keys(SESSION_FEATURE_LABELS) as ProviderFeature[]).filter((f) => !supports.includes(f)).map((f) => SESSION_FEATURE_LABELS[f]!);
  if (!missing.length) return null;
  return `${joinWords(missing)} ${missing.length === 1 ? 'works' : 'work'} with Claude Code only, for now.`;
}

/** What New session had on that a profile of another provider can't keep. */
export interface SwitchChoices {
  worktree: boolean;
  /** A branch to check out first (not the current one). */
  branch: string | null;
  /** Run as › a pipeline. */
  pipeline: string | null;
  /** The box holds a queued (Later) item or a schedule. */
  later: boolean;
  schedule: boolean;
}

export type SwitchLoss = 'worktree' | 'branch' | 'pipeline' | 'later' | 'schedule';

/**
 * What switching to a profile of `provider` turns off, of what was on: the features it doesn't support yet. Empty for
 * Claude Code, and when nothing that was on goes.
 */
export function switchLosses(choices: SwitchChoices, provider: SessionProvider, supports: readonly ProviderFeature[]): SwitchLoss[] {
  if (provider === 'claude') return [];
  const on: Record<SwitchLoss, boolean> = { worktree: choices.worktree, branch: !!choices.branch, pipeline: !!choices.pipeline, later: choices.later, schedule: choices.schedule };
  return (Object.keys(on) as SwitchLoss[]).filter((loss) => on[loss] && !supports.includes(loss));
}

const LOSS_WORDS: Record<SwitchLoss, { what: string; cant: string }> = {
  worktree: { what: 'Worktree', cant: 'run in a worktree' },
  branch: { what: 'Branch checkout', cant: 'check out a branch first' },
  pipeline: { what: 'Pipeline', cant: 'run pipelines' },
  later: { what: 'Later', cant: 'start from the queue' },
  schedule: { what: 'Schedule', cant: 'run on a schedule' },
};

/** The notice for what a switch turned off: "Worktree turned off. GitHub Copilot can't run in a worktree yet." */
export function switchNotice(losses: readonly SwitchLoss[], provider: SessionProvider): string | null {
  if (!losses.length) return null;
  const name = PROVIDER_NAMES[provider];
  if (losses.length === 1) return `${LOSS_WORDS[losses[0]!].what} turned off. ${name} can't ${LOSS_WORDS[losses[0]!].cant} yet.`;
  return `${joinWords(losses.map((l, i) => (i === 0 ? LOSS_WORDS[l].what : LOSS_WORDS[l].what.toLowerCase())))} turned off. ${name} can't ${joinWords(losses.map((l) => LOSS_WORDS[l].cant))} yet.`;
}

/** A control another provider doesn't have yet says why: "Not with GitHub Copilot yet". */
export const notWithYet = (provider: SessionProvider): string => `Not with ${PROVIDER_NAMES[provider]} yet`;

/** A session's provider: summaries from before providers existed (and the phone's) have none, and are Claude's. */
export const providerOf = (session: { provider?: SessionProvider | null | undefined }): SessionProvider => session.provider ?? 'claude';

/** The provider of another agent's session; null for Claude Code's. */
export const otherProviderOf = (session: { provider?: SessionProvider | null | undefined }): OptionalProvider | null => {
  const provider = providerOf(session);
  return provider === 'claude' ? null : provider;
};

/**
 * Another provider's session: Claude Code's own actions (fork, rewind, Ask, rename, delete, the clean-up) don't apply.
 * Sending does when the provider can start sessions (`ProviderInfo.canStart`); otherwise it is read-only.
 */
export const isOtherProviderSession = (session: { provider?: SessionProvider | null | undefined }): boolean => otherProviderOf(session) !== null;
