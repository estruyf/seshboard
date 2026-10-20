import { AUTO_MODEL, AUTO_TIERS, tierLabel, type AutoTier, type Effort, type PermissionMode, type RemoteOptions, type RemotePermissionMode, type RemoteProfile, type RemoteSession } from '@switchboard/protocol/remote-client';

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

/** The dot of a Claude profile's colour, as a theme colour. */
export const PROFILE_DOT: Record<RemoteProfile['color'], string> = {
  yellow: 'bg-profile-yellow',
  blue: 'bg-profile-blue',
  green: 'bg-profile-green',
  purple: 'bg-profile-purple',
  red: 'bg-profile-red',
  orange: 'bg-profile-orange',
  gray: 'bg-profile-gray',
};

/** What a new session starts with: the project's defaults, then its profile's, until you change one, for this session only. */
export interface Choice {
  profileId: string;
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  worktree: boolean;
}

/** The profiles, also from a computer whose Switchboard doesn't send them yet. */
export const profilesOf = (options: RemoteOptions | null): RemoteProfile[] => options?.profiles ?? [];

/** The profile a new session in the project runs with unless you pick another: the project's, else the default. */
export function projectProfile(options: RemoteOptions | null, projectId: string | null): string {
  return options?.projects.find((p) => p.id === projectId)?.profileId ?? options?.defaultProfileId ?? 'default';
}

/** The project's defaults, then those of the profile (the project's own unless you picked another). */
export function defaultChoice(options: RemoteOptions | null, projectId: string | null, profileId: string = projectProfile(options, projectId)): Choice {
  const project = options?.projects.find((p) => p.id === projectId)?.defaults;
  const profile = profilesOf(options).find((p) => p.id === profileId)?.defaults;
  const model = project?.model ?? profile?.model ?? null;
  return {
    profileId,
    // A default of Auto while Auto is off starts on the default model, as on the computer.
    model: model === AUTO_MODEL && !autoOn(options) ? null : model,
    effort: project?.effort ?? profile?.effort ?? null,
    permissionMode: project?.permissionMode ?? profile?.permissionMode ?? 'default',
    worktree: project?.worktree ?? profile?.worktree ?? false,
  };
}

/**
 * Only what differs from the defaults goes to the computer, so a default changed meanwhile still applies; the profile
 * only when it isn't the project's (`projectProfileId`).
 */
export function changedFrom(choice: Choice, defaults: Choice, projectProfileId: string = defaults.profileId): { profileId?: string; model?: string | null; effort?: Effort | null; permissionMode?: RemotePermissionMode; worktree?: boolean } {
  return {
    ...(choice.profileId !== projectProfileId ? { profileId: choice.profileId } : {}),
    ...(choice.model !== defaults.model ? { model: choice.model } : {}),
    ...(choice.effort !== defaults.effort ? { effort: choice.effort } : {}),
    ...(choice.permissionMode !== defaults.permissionMode && isRemoteMode(choice.permissionMode) ? { permissionMode: choice.permissionMode } : {}),
    ...(choice.worktree !== defaults.worktree ? { worktree: choice.worktree } : {}),
  };
}

export const isRemoteMode = (mode: PermissionMode): mode is RemotePermissionMode => mode === 'default' || mode === 'acceptEdits' || mode === 'plan' || mode === 'auto';

/** A model's name as the list has it ("Opus"); a full id the list doesn't know as written; null is the default. */
export function modelLabel(models: RemoteOptions['models'], value: string | null): string {
  if (value === AUTO_MODEL) return 'Auto';
  if (!value) return models.find((m) => m.value === 'default')?.displayName ?? 'Default model';
  const known = models.find((m) => m.value === value);
  if (known) return known.displayName;
  const family = /claude-(opus|sonnet|haiku)/i.exec(value)?.[1];
  return family ? family[0]!.toUpperCase() + family.slice(1).toLowerCase() : value;
}

/** Whether a model takes an effort (the default one does). */
export const takesEffort = (models: RemoteOptions['models'], value: string | null) => !value || (models.find((m) => m.value === value)?.supportsEffort ?? true);

/** Auto is on in Settings › Conversation (a Switchboard from before phones knew it says nothing: off). */
export const autoOn = (options: RemoteOptions | null) => options?.auto?.enabled ?? false;

/** "Sonnet or Opus", "Haiku, Sonnet or Opus": the models Auto may pick, in tier order. */
export function tierList(tiers: readonly AutoTier[]): string {
  const names = AUTO_TIERS.filter((t) => tiers.includes(t)).map(tierLabel);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/** Auto's line in the model list, as on the computer. */
export const autoDescription = (allowed: readonly AutoTier[]) => `Haiku reads your prompt and picks ${tierList(allowed)}. Picked once, when the session starts.`;

/** What a running session's model chip says about Auto: "Auto" while it picks, then what it picked; null without Auto. */
export function autoFace(auto: RemoteSession['auto']): string | null {
  if (!auto) return null;
  if (auto.choosing) return 'Auto';
  return `Auto · ${auto.picked ? tierLabel(auto.picked) : 'Default model'}`;
}
