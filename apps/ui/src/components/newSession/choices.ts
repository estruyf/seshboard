import { inheritedDefault, inheritedPermissionMode, isBranchBase, type Effort, type NewSessionMode, type PermissionMode, type Preferences, type ProfileDefaults, type ProjectDefaults, type WorktreeBase } from '@seshboard/protocol/client';

/** What a new session starts with. Empty strings mean "Claude Code's default" (model, effort) or "keep the checked-out branch". */
export interface Choices {
  model: string;
  permissionMode: PermissionMode;
  effort: Effort | '';
  workspace: 'current' | 'worktree';
  /** Where a new worktree starts: `fresh`, `head`, or a branch of the repository. */
  baseRef: WorktreeBase;
  branch: string;
}

/**
 * The global defaults: what a field starts with where no project or profile decides. Branches belong to a repository,
 * so they never become global: not the one to check out, and not the one a worktree starts from.
 */
export type GlobalChoices = Omit<Choices, 'branch' | 'baseRef'> & { baseRef: 'fresh' | 'head' };

/** Where the global choices (and the last folder) are kept in the engine's app state. */
export const DEFAULTS_KEY = 'newSession.defaults';

export const INITIAL_CHOICES: GlobalChoices = { model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

/**
 * The global defaults set in Settings › General: its model and effort (empty leaves them to Claude Code). The permission
 * mode goes through `globalMode`, which also knows Remember last.
 */
export function globalChoices(prefs: Pick<Preferences, 'newSessionModel' | 'newSessionEffort'>): GlobalChoices {
  return { ...INITIAL_CHOICES, model: prefs.newSessionModel, effort: prefs.newSessionEffort };
}

const FIELDS = ['model', 'permissionMode', 'effort', 'workspace', 'baseRef', 'branch'] as const;

/** Where the permission mode last picked in New session or the palette is kept, for Remember last. */
export const LAST_MODE_KEY = 'newSession.lastMode';

/** Modes New session can start in by itself: never one that skips every check, as in the mode menus. */
const REMEMBERED_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/** Reads the stored last mode leniently: Ask first when there is none, or it is one New session doesn't offer. */
export function readLastMode(value: unknown): PermissionMode {
  return REMEMBERED_MODES.includes(value as PermissionMode) ? (value as PermissionMode) : 'default';
}

/**
 * The global permission mode (Settings › General): the one set there, or with Remember last the one picked last.
 * `last` is null where the mode picked last doesn't count (a link, a trigger): Ask first then.
 */
export function globalMode(setting: NewSessionMode, last: PermissionMode | null): PermissionMode {
  return setting === 'remember' ? (last ?? INITIAL_CHOICES.permissionMode) : setting;
}

/**
 * The permission mode a new session starts in: the project's or profile's (`defaults`, see `layeredDefaults`), else
 * the global one. The session can still change it.
 */
export function startingMode(setting: NewSessionMode, defaults: ProjectDefaults | null | undefined, last: PermissionMode): PermissionMode {
  return defaults?.permissionMode ?? globalMode(setting, last);
}

/**
 * What New session and the palette's prompt start with: the project's and profile's defaults, else the global ones
 * (`globals`, see `globalChoices`) and the global permission mode.
 */
export function newSessionChoices(defaults: ProjectDefaults | null | undefined, setting: NewSessionMode, last: PermissionMode, globals: GlobalChoices = INITIAL_CHOICES): Choices {
  return { ...startingChoices(globals, defaults), permissionMode: startingMode(setting, defaults, last) };
}

/**
 * The defaults a new session starts from: the project's own, and its profile's where the project sets
 * nothing and doesn't skip it for the global one. Null when neither has any, so every field follows the global defaults.
 */
export function layeredDefaults(project: ProjectDefaults | null | undefined, profile: ProfileDefaults | null | undefined): ProjectDefaults | null {
  if (!profile || Object.values(profile).every((v) => v === null)) return project ?? null;
  return {
    model: inheritedDefault('model', project, profile),
    effort: inheritedDefault('effort', project, profile),
    permissionMode: inheritedPermissionMode(project, profile),
    workspace: project?.workspace ?? profile.workspace,
    baseRef: project?.baseRef ?? profile.baseRef,
    branch: project?.branch ?? null,
    defaultBranch: project?.defaultBranch ?? null,
  };
}

/**
 * The choices a new session starts from: `project` (the project's and profile's defaults, see `layeredDefaults`),
 * and the global ones where it sets none.
 */
export function startingChoices(globals: GlobalChoices, project: ProjectDefaults | null | undefined): Choices {
  return {
    model: project?.model ?? globals.model,
    permissionMode: project?.permissionMode ?? globals.permissionMode,
    effort: project?.effort ?? globals.effort,
    workspace: project?.workspace ?? globals.workspace,
    baseRef: project?.baseRef ?? globals.baseRef,
    branch: project?.branch ?? '',
  };
}

/**
 * Permission modes in which Claude never stops to ask (it decides itself, or skips the checks):
 * a session started by a link never runs in one of them, since any web page can open a link.
 */
const NEVER_ASKS: readonly PermissionMode[] = ['bypassPermissions', 'auto', 'dontAsk'];

/** The permission mode a session started by an `autostart` link runs in: `mode` (the project's or profile's default), unless it never asks. */
export function linkPermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
  return mode && !NEVER_ASKS.includes(mode) ? mode : 'default';
}

/**
 * The choices for a session an `autostart` link starts: as `startingChoices`, but the permission
 * mode comes from the project's or profile's default, else the global one (never the mode you last picked), and is
 * never one that skips permission prompts.
 */
export function linkStartingChoices(globals: GlobalChoices, project: ProjectDefaults | null | undefined, setting: NewSessionMode): Choices {
  return { ...startingChoices(globals, project), permissionMode: linkPermissionMode(project?.permissionMode ?? globalMode(setting, null)) };
}

/** The choices as a project's defaults ("Save as project default"), keeping the project's default branch, which New session doesn't choose. */
export function toProjectDefaults(choices: Choices, defaultBranch: string | null = null): ProjectDefaults {
  return {
    model: choices.model || null,
    effort: choices.effort || null,
    permissionMode: choices.permissionMode,
    workspace: choices.workspace,
    baseRef: choices.baseRef,
    // A branch only applies to the current folder; a worktree gets its own.
    branch: choices.workspace === 'current' ? choices.branch || null : null,
    defaultBranch,
  };
}

export function sameDefaults(a: ProjectDefaults, b: ProjectDefaults): boolean {
  return FIELDS.every((key) => a[key] === b[key]);
}

/** Reads stored global defaults leniently (older builds stored the folder alongside). */
export function readGlobals(value: unknown): { globals: GlobalChoices; cwd: string | null } {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const pick = <K extends keyof GlobalChoices>(key: K, ok: (v: unknown) => boolean) => (ok(raw[key]) ? (raw[key] as GlobalChoices[K]) : INITIAL_CHOICES[key]);
  return {
    globals: {
      model: pick('model', (v) => typeof v === 'string'),
      permissionMode: pick('permissionMode', (v) => typeof v === 'string' && v !== ''),
      effort: pick('effort', (v) => typeof v === 'string'),
      workspace: pick('workspace', (v) => v === 'current' || v === 'worktree'),
      baseRef: pick('baseRef', (v) => v === 'fresh' || v === 'head'),
    },
    cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
  };
}
