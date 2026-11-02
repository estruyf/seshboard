import { PROVIDER_SHORT_NAMES, SESSION_PROVIDERS, switchLosses, switchNotice, type ProviderFeature, type SessionProvider, type SwitchLoss } from '@seshboard/protocol/client';

/** Profiles grouped by the tool that runs them, Claude Code's first, each group in the profiles' own order. */
export const byTool = <T extends { provider: SessionProvider }>(profiles: readonly T[]): T[] => [...profiles].sort((a, b) => SESSION_PROVIDERS.indexOf(a.provider) - SESSION_PROVIDERS.indexOf(b.provider));

/** What New session had on when its profile changed, as far as another provider can't keep it. */
export interface SwitchFrom {
  /** The profile picked for this session only before the switch (null: the project's, else the default). */
  profileOverride: string | null;
  /** The provider of the profile it had. */
  provider: SessionProvider;
  worktree: boolean;
  /** A branch to check out first (only on the current checkout; a worktree's base branch goes with the worktree). */
  checkoutBranch: string | null;
  /** Run as › a pipeline. */
  runAsId: string | null;
  /** The box holds a queued item, or opened to queue after a session (Later). */
  later: boolean;
  /** The box holds a schedule, or opened to schedule (Schedule a session). */
  schedule: boolean;
}

/** The notice after a switch turned something off, and what Back puts back. */
export interface SwitchNoticeState {
  /** The profile override to go back to. */
  back: string | null;
  provider: SessionProvider;
  losses: SwitchLoss[];
  text: string;
}

/**
 * Switching New session to a profile of `to` (with the Claude Code features it `supports`): what that turns off of
 * what was on, as a notice with the way back. Null when nothing goes, or the switch is between profiles of one provider.
 */
export function switchNoticeFor(from: SwitchFrom, to: SessionProvider, supports: readonly ProviderFeature[]): SwitchNoticeState | null {
  if (from.provider === to) return null;
  const losses = switchLosses({ worktree: from.worktree, branch: from.worktree ? null : from.checkoutBranch, pipeline: from.runAsId, later: from.later, schedule: from.schedule }, to, supports);
  const text = switchNotice(losses, to);
  return text ? { back: from.profileOverride, provider: to, losses, text } : null;
}

/**
 * The hint's link under the box, "Use Copilot for seshboard from now on": only for a project whose own profile (or the
 * default, where it has none) isn't the one picked.
 */
export function offersProjectProfile(input: { isProject: boolean; profileId: string; projectProfile: string | null; defaultProfile: string }): boolean {
  return input.isProject && input.profileId !== (input.projectProfile ?? input.defaultProfile);
}

/** The placeholder of New session's box: who works on it, by its short name. */
export const askWhat = (provider: SessionProvider) => `What should ${PROVIDER_SHORT_NAMES[provider]} work on?`;
