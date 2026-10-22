import type { NewSessionMode, PermissionMode } from '@switchboard/protocol/client';

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
export { randomWorktreeName } from '@switchboard/protocol/client';
