import type { NewSessionMode, PermissionMode } from '@seshboard/protocol/client';

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

/** The line under Settings › General › Global permission mode, also what Settings' search shows. */
export const GLOBAL_MODE_DETAIL = 'What new sessions start in, unless their Claude profile or project sets a mode. A session can still change it. A link never starts in Auto mode.';

/** The lines under Settings › General › Global model and Global effort, also what Settings' search shows. */
export const GLOBAL_MODEL_DETAIL = 'What new sessions start on, unless their Claude profile or project sets a model. A session can still change it.';
export const GLOBAL_EFFORT_DETAIL = 'How hard new sessions think, unless their Claude profile or project sets an effort. A session can still change it.';

/** The global permission mode as a menu names it: its mode, or the one picked last. */
export const globalModeLabel = (setting: NewSessionMode) => (setting === 'remember' ? 'Last picked' : MODE_LABEL[setting]);

/** The status dot per mode, as a theme colour. */
export const MODE_DOT: Partial<Record<PermissionMode, string>> = {
  default: 'bg-ok',
  acceptEdits: 'bg-link',
  plan: 'bg-faint',
  auto: 'bg-accent-ink',
};

/** Modes offered in menus. Bypass is left out on purpose. */
export const MODE_CHOICES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/** ⇧Tab cycles like the Claude Code CLI. */
export function nextMode(mode: PermissionMode): PermissionMode {
  const cycle: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
  const index = cycle.indexOf(mode);
  return cycle[(index + 1) % cycle.length]!;
}

/** A random three-word worktree name; shared with the engine, which names a queued item's worktree the same way. */
export { randomWorktreeName } from '@seshboard/protocol/client';
