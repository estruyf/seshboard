import type { Choice } from './options.ts';

/**
 * New session's Options row on a phone: two lines that sum up the choices ("Personal · Default model · Auto", "This
 * folder on dev · one session"), each part marked when it differs from the project's defaults (the row shows those in
 * the accent colour), and whether Start can start yet. Pure, with tests.
 */

export interface SummaryPart {
  text: string;
  /** Not the project's default: picked for this session. */
  changed: boolean;
}

export interface OptionsSummary {
  first: SummaryPart[];
  second: SummaryPart[];
  /** Both lines in one, for the row's label. */
  label: string;
}

/** What the summary says, worded by the caller (the model's name, the mode's word) so it stays the lists' words. */
export interface SummaryInput {
  choice: Choice;
  defaults: Choice;
  /** The project's profile: another one is a change. */
  baseProfile: string;
  /** The profile's name; null with one profile, when there's nothing to pick. */
  profile: string | null;
  model: string;
  /** The effort's word; null while it is the model's own and unchanged. */
  effort: string | null;
  mode: string;
  /** The branch it starts on in the project's folder (null: not known), and whether you picked it. */
  branch: string | null;
  branchPicked: boolean;
  /** The pipeline Run as picked; null for one session. */
  pipeline: string | null;
}

export function optionsSummary(input: SummaryInput): OptionsSummary {
  const { choice, defaults } = input;
  const first: SummaryPart[] = [
    ...(input.profile ? [{ text: input.profile, changed: choice.profileId !== input.baseProfile }] : []),
    { text: input.model, changed: choice.model !== defaults.model },
    ...(input.effort ? [{ text: input.effort, changed: choice.effort !== defaults.effort }] : []),
    { text: input.mode, changed: choice.permissionMode !== defaults.permissionMode },
  ];
  // A pipeline makes its own worktree for its steps.
  const second: SummaryPart[] = input.pipeline
    ? [{ text: `Runs as ${input.pipeline}`, changed: true }]
    : [
        choice.worktree ? { text: 'New worktree', changed: choice.worktree !== defaults.worktree } : { text: input.branch ? `This folder on ${input.branch}` : 'This folder', changed: choice.worktree !== defaults.worktree || input.branchPicked },
        { text: 'one session', changed: false },
      ];
  const line = (parts: SummaryPart[]) => parts.map((p) => p.text).join(' · ');
  return { first, second, label: `${line(first)}, ${line(second)}` };
}

/**
 * The Options row with another provider (GitHub Copilot): who runs it, its model and its mode. It works in the
 * project's folder as it is: worktrees, branches and pipelines are Claude Code's.
 */
export function providerSummary({ provider, model, mode }: { provider: string; model: string; mode: string }): OptionsSummary {
  const first: SummaryPart[] = [
    { text: provider, changed: true },
    { text: model, changed: false },
    { text: mode, changed: false },
  ];
  const second: SummaryPart[] = [
    { text: 'This folder', changed: false },
    { text: 'one session', changed: false },
  ];
  const line = (parts: SummaryPart[]) => parts.map((p) => p.text).join(' · ');
  return { first, second, label: `${line(first)}, ${line(second)}` };
}

/**
 * Whether Start (or Send) can go now, and if not, why: the words its button says to a screen reader and a long press.
 * `blocked`: why the provider picked can't start a session (install it, or sign in with its CLI), or that it is asked.
 */
export function startState({ connected, project, text, busy, reading, blocked = null }: { connected: boolean; project: boolean; text: string; busy: boolean; reading: boolean; blocked?: string | null }): { ready: boolean; reason: string | null } {
  if (!connected) return { ready: false, reason: 'Waiting for the connection' };
  if (blocked) return { ready: false, reason: blocked };
  if (!project) return { ready: false, reason: 'Pick a project first' };
  if (!text.trim()) return { ready: false, reason: 'Type a message first' };
  if (reading) return { ready: false, reason: 'Reading the attachments…' };
  if (busy) return { ready: false, reason: 'Starting…' };
  return { ready: true, reason: null };
}
