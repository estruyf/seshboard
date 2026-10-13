import type { Effort, NewSessionMode, PermissionMode, ProjectDefaults } from '@switchboard/protocol/client';

/** What a new session starts with. Empty strings mean "Claude Code's default" (model, effort) or "keep the checked-out branch". */
export interface Choices {
  model: string;
  permissionMode: PermissionMode;
  effort: Effort | '';
  workspace: 'current' | 'worktree';
  baseRef: 'fresh' | 'head';
  branch: string;
}

/** The global defaults: the choices last used for a field no project decides. Branches belong to a repository, so they never become global. */
export type GlobalChoices = Omit<Choices, 'branch'>;

/** Where the global choices (and the last folder) are kept in the engine's app state. */
export const DEFAULTS_KEY = 'newSession.defaults';

export const INITIAL_CHOICES: GlobalChoices = { model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

const FIELDS = ['model', 'permissionMode', 'effort', 'workspace', 'baseRef', 'branch'] as const;

/**
 * The global defaults with the permission mode Settings sets for new sessions (Settings › General), unless it is
 * the one you picked last. The mode you pick is still remembered, for when the setting goes back to that.
 */
export function withNewSessionMode(globals: GlobalChoices, mode: NewSessionMode): GlobalChoices {
  return mode === 'last' ? globals : { ...globals, permissionMode: mode };
}

/** The choices a new session in a project starts from: the project's defaults, and the global ones where it sets none. */
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

/** The permission mode a session started by an `autostart` link runs in: `mode` (the project's default), unless it never asks. */
export function linkPermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
  return mode && !NEVER_ASKS.includes(mode) ? mode : 'default';
}

/**
 * The choices for a session an `autostart` link starts: as `startingChoices`, but the permission
 * mode comes only from the project's own default (never from the mode you last picked), and is
 * never one that skips permission prompts.
 */
export function linkStartingChoices(globals: GlobalChoices, project: ProjectDefaults | null | undefined): Choices {
  return { ...startingChoices(globals, project), permissionMode: linkPermissionMode(project?.permissionMode) };
}

/**
 * The part of a change that updates the global defaults: fields the project decides apply to this
 * session only (until saved as the project's default).
 */
export function globalPatch(patch: Partial<Choices>, project: ProjectDefaults | null | undefined): Partial<GlobalChoices> {
  const out: Partial<GlobalChoices> = {};
  for (const key of FIELDS) {
    if (key === 'branch' || !(key in patch) || (project && project[key] !== null)) continue;
    (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

/** The choices as a project's defaults ("Save as project default"). */
export function toProjectDefaults(choices: Choices): ProjectDefaults {
  return {
    model: choices.model || null,
    effort: choices.effort || null,
    permissionMode: choices.permissionMode,
    workspace: choices.workspace,
    baseRef: choices.baseRef,
    // A branch only applies to the current folder; a worktree gets its own.
    branch: choices.workspace === 'current' ? choices.branch || null : null,
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
