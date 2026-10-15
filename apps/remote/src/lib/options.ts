import type { Effort, PermissionMode, RemoteOptions, RemotePermissionMode } from '@switchboard/protocol/remote-client';

/**
 * New session's choices on a phone, worded as on the computer (apps/ui `lib/modes.ts`, `newSession/route.ts`). Pure,
 * with tests.
 */

/** The chip's name for a mode; the list adds what it does. */
export const MODE_SHORT: Record<PermissionMode, string> = {
  default: 'Ask first',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass',
};

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

export const MODE_DESCRIPTION: Record<RemotePermissionMode, string> = {
  default: 'Approve every edit and command',
  acceptEdits: 'File edits apply, commands still ask',
  plan: 'Read and plan, no changes',
  auto: 'Claude only asks when it matters',
};

/** The status dot per mode, as a theme colour. */
export const MODE_DOT: Record<PermissionMode, string> = {
  default: 'bg-ok',
  acceptEdits: 'bg-link',
  plan: 'bg-faint',
  auto: 'bg-accent-ink',
  dontAsk: 'bg-error',
  bypassPermissions: 'bg-error',
};

export const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

/** What a new session starts with: the project's defaults until you change one, for this session only. */
export interface Choice {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  worktree: boolean;
}

export function defaultChoice(options: RemoteOptions | null, projectId: string | null): Choice {
  const defaults = options?.projects.find((p) => p.id === projectId)?.defaults;
  return { model: defaults?.model ?? null, effort: defaults?.effort ?? null, permissionMode: defaults?.permissionMode ?? 'default', worktree: defaults?.worktree ?? false };
}

/** Only what differs from the project's defaults goes to the computer, so a default changed meanwhile still applies. */
export function changedFrom(choice: Choice, defaults: Choice): { model?: string | null; effort?: Effort | null; permissionMode?: RemotePermissionMode; worktree?: boolean } {
  return {
    ...(choice.model !== defaults.model ? { model: choice.model } : {}),
    ...(choice.effort !== defaults.effort ? { effort: choice.effort } : {}),
    ...(choice.permissionMode !== defaults.permissionMode && isRemoteMode(choice.permissionMode) ? { permissionMode: choice.permissionMode } : {}),
    ...(choice.worktree !== defaults.worktree ? { worktree: choice.worktree } : {}),
  };
}

export const isRemoteMode = (mode: PermissionMode): mode is RemotePermissionMode => mode === 'default' || mode === 'acceptEdits' || mode === 'plan' || mode === 'auto';

/** A model's name as the list has it ("Opus"); a full id the list doesn't know as written; null is the default. */
export function modelLabel(models: RemoteOptions['models'], value: string | null): string {
  if (!value) return models.find((m) => m.value === 'default')?.displayName ?? 'Default model';
  const known = models.find((m) => m.value === value);
  if (known) return known.displayName;
  const family = /claude-(opus|sonnet|haiku)/i.exec(value)?.[1];
  return family ? family[0]!.toUpperCase() + family.slice(1).toLowerCase() : value;
}

/** Whether a model takes an effort (the default one does). */
export const takesEffort = (models: RemoteOptions['models'], value: string | null) => !value || (models.find((m) => m.value === value)?.supportsEffort ?? true);
