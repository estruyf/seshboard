import { isBranchBase, type Effort, type NewSessionMode, type PermissionMode, type ProfileDefaults, type ProjectDefaults, type WorktreeBase } from '@switchboard/protocol/client';

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
 * The global defaults: the choices last used for a field no project or profile decides. Branches belong to a repository,
 * so they never become global: not the one to check out, and not the one a worktree starts from.
 */
export type GlobalChoices = Omit<Choices, 'branch' | 'baseRef'> & { baseRef: 'fresh' | 'head' };

/** Where the global choices (and the last folder) are kept in the engine's app state. */
export const DEFAULTS_KEY = 'newSession.defaults';

export const INITIAL_CHOICES: GlobalChoices = { model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

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
 * The permission mode a new session starts in, from Settings › General › Permission mode: the project's or profile's
 * own default, else Ask first (`project`); the one picked last (`remember`); or always the one Settings sets, over
 * the project's default.
 */
export function startingMode(setting: NewSessionMode, defaults: ProjectDefaults | null | undefined, last: PermissionMode): PermissionMode {
  if (setting === 'project') return defaults?.permissionMode ?? INITIAL_CHOICES.permissionMode;
  if (setting === 'remember') return last;
  return setting;
}

/** What New session and the palette's prompt start with: the project's and profile's defaults, and the mode Settings says. */
export function newSessionChoices(defaults: ProjectDefaults | null | undefined, setting: NewSessionMode, last: PermissionMode): Choices {
  return { ...startingChoices(INITIAL_CHOICES, defaults), permissionMode: startingMode(setting, defaults, last) };
}

/**
 * The defaults a new session starts from: the project's own, and its profile's where the project sets
 * nothing. Null when neither has any, so every field follows the global defaults.
 */
export function layeredDefaults(project: ProjectDefaults | null | undefined, profile: ProfileDefaults | null | undefined): ProjectDefaults | null {
  if (!profile || Object.values(profile).every((v) => v === null)) return project ?? null;
  return {
    model: project?.model ?? profile.model,
    effort: project?.effort ?? profile.effort,
    permissionMode: project?.permissionMode ?? profile.permissionMode,
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
 * mode comes only from the project's or profile's default (never from the mode you last picked), and is
 * never one that skips permission prompts.
 */
export function linkStartingChoices(globals: GlobalChoices, project: ProjectDefaults | null | undefined): Choices {
  return { ...startingChoices(globals, project), permissionMode: linkPermissionMode(project?.permissionMode) };
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
