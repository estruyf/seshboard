import { AUTO_MODEL, tierLabel, type Effort, type PermissionMode, type RemoteOptions, type RemotePermissionMode, type RemoteProfile, type RemoteProject, type RemoteSession, type RemoteSessionOptions, type RemoteSessions } from '@switchboard/protocol/client';

/** A project tile in New session on another computer: the project, and how its sessions there are. */
export interface RemoteTile {
  id: string;
  project: RemoteProject;
  tone: 'needs-you' | 'working' | 'idle';
  /** "needs you", "1 working", "idle". */
  label: string;
}

/**
 * Another computer's projects as New session's tiles (pure, so it can be tested): the ones with something going on
 * first (needs you, then working), then the most recently active, then by name. The state comes from that computer's
 * session list, with the same rules as its sidebar: an open prompt is needs you.
 */
export function remoteProjectTiles(projects: readonly RemoteProject[], list: RemoteSessions | null): RemoteTile[] {
  const asking = new Set(list?.prompts.map((p) => p.sessionId));
  const stats = new Map<string, { needs: number; working: number; last: number }>();
  for (const session of list?.sessions ?? []) {
    const entry = stats.get(session.projectId) ?? { needs: 0, working: 0, last: 0 };
    if (asking.has(session.id) || session.status === 'needs-you') entry.needs++;
    else if (session.status === 'working' || session.status === 'background') entry.working++;
    entry.last = Math.max(entry.last, session.updatedAt);
    stats.set(session.projectId, entry);
  }
  const rank = (id: string) => {
    const s = stats.get(id);
    return s?.needs ? 0 : s?.working ? 1 : 2;
  };
  return [...projects]
    .sort((a, b) => rank(a.id) - rank(b.id) || (stats.get(b.id)?.last ?? 0) - (stats.get(a.id)?.last ?? 0) || a.name.localeCompare(b.name))
    .map((project) => {
      const s = stats.get(project.id);
      if (s?.needs) return { id: project.id, project, tone: 'needs-you' as const, label: 'needs you' };
      if (s?.working) return { id: project.id, project, tone: 'working' as const, label: `${s.working} working` };
      return { id: project.id, project, tone: 'idle' as const, label: 'idle' };
    });
}

/**
 * What New session on another computer starts with: the project's defaults, then those of its profile, until you
 * change one, for this session only. Worded and resolved as in the remote app (`apps/remote/src/lib/options.ts`).
 */
export interface RemoteChoice {
  profileId: string;
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  worktree: boolean;
}

/** That computer's profiles, also from a Switchboard that doesn't send them yet. */
export const remoteProfiles = (options: RemoteOptions | null): RemoteProfile[] => options?.profiles ?? [];

/** The profile a new session in the project runs with unless you pick another: the project's, else the default. */
export function remoteProjectProfile(options: RemoteOptions | null, projectId: string | null): string {
  return options?.projects.find((p) => p.id === projectId)?.profileId ?? options?.defaultProfileId ?? 'default';
}

/** The project's defaults, then those of the profile (the project's own unless you picked another). */
export function remoteDefaultChoice(options: RemoteOptions | null, projectId: string | null, profileId: string = remoteProjectProfile(options, projectId)): RemoteChoice {
  const project = options?.projects.find((p) => p.id === projectId)?.defaults;
  const profile = remoteProfiles(options).find((p) => p.id === profileId)?.defaults;
  const model = project?.model ?? profile?.model ?? null;
  return {
    profileId,
    // A default of Auto while Auto is off there starts on the default model, as on that computer.
    model: model === AUTO_MODEL && !options?.auto?.enabled ? null : model,
    effort: project?.effort ?? profile?.effort ?? null,
    permissionMode: project?.permissionMode ?? profile?.permissionMode ?? 'default',
    worktree: project?.worktree ?? profile?.worktree ?? false,
  };
}

export const isRemoteMode = (mode: PermissionMode): mode is RemotePermissionMode => mode === 'default' || mode === 'acceptEdits' || mode === 'plan' || mode === 'auto';

/**
 * What `session.create` gets: only what differs from the defaults, so a default changed there meanwhile still
 * applies; the profile only when it isn't the project's. A mode only a computer itself may pick (bypass) is never sent.
 */
export function remoteChanges(choice: RemoteChoice, defaults: RemoteChoice, projectProfileId: string): RemoteSessionOptions {
  return {
    ...(choice.profileId !== projectProfileId ? { profileId: choice.profileId } : {}),
    ...(choice.model !== defaults.model ? { model: choice.model } : {}),
    ...(choice.effort !== defaults.effort ? { effort: choice.effort } : {}),
    ...(choice.permissionMode !== defaults.permissionMode && isRemoteMode(choice.permissionMode) ? { permissionMode: choice.permissionMode } : {}),
    ...(choice.worktree !== defaults.worktree ? { worktree: choice.worktree } : {}),
  };
}

/** A model's name as that computer's list has it ("Opus"); a full id the list doesn't know, by its family; null is the default. */
export function remoteModelLabel(models: RemoteOptions['models'], value: string | null): string {
  if (value === AUTO_MODEL) return 'Auto';
  if (!value) return models.find((m) => m.value === 'default')?.displayName ?? 'Default model';
  const known = models.find((m) => m.value === value);
  if (known) return known.displayName;
  const family = /claude-(opus|sonnet|haiku)/i.exec(value)?.[1];
  return family ? family[0]!.toUpperCase() + family.slice(1).toLowerCase() : value;
}

/** Whether a model takes an effort (the default one does). */
export const remoteTakesEffort = (models: RemoteOptions['models'], value: string | null) => !value || (models.find((m) => m.value === value)?.supportsEffort ?? true);

/** What a running session's model chip says about Auto: "Auto" while it picks, then "Auto · Sonnet"; null without Auto. */
export function remoteAutoFace(auto: RemoteSession['auto']): string | null {
  if (!auto) return null;
  if (auto.choosing) return 'Auto';
  return `Auto · ${auto.picked ? tierLabel(auto.picked) : 'Default model'}`;
}
