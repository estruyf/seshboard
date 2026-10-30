import type { Effort, PermissionMode } from './host.ts';

/** The defaults a project inherits from its Claude profile, each of which it can also skip for the global one. */
interface Inheritable {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
}

/** For each inheritable field, the project's flag that skips its profile's value and follows the global one. */
const SKIPS_PROFILE = { model: 'globalModel', effort: 'globalEffort', permissionMode: 'globalPermissionMode' } as const satisfies Record<keyof Inheritable, string>;

/** A project's flags that skip its profile's model, effort or permission mode (see `SKIPS_PROFILE`). */
export type SkipsProfile = { [K in keyof Inheritable as (typeof SKIPS_PROFILE)[K]]?: boolean };

/**
 * What a new session in a project inherits for `field`, before the session's own choice: the project's, else its
 * Claude profile's. A project can skip its profile's (`globalModel`, `globalEffort`, `globalPermissionMode`). Null
 * means neither sets one, so the session starts with the global one (Settings › General).
 */
export function inheritedDefault<K extends keyof Inheritable>(
  field: K,
  project: (Pick<Inheritable, K> & SkipsProfile) | null | undefined,
  profile: Pick<Inheritable, K> | null | undefined,
): Inheritable[K] | null {
  // The flags' keys never overlap the fields', which TypeScript can't see through the intersection.
  const own = (project as Pick<Inheritable, K> | null | undefined)?.[field];
  if (own) return own;
  if (project?.[SKIPS_PROFILE[field]]) return null;
  return profile?.[field] ?? null;
}

/** The permission mode a new session in a project inherits (`inheritedDefault`); null starts it in the global mode. */
export function inheritedPermissionMode(
  project: { permissionMode: PermissionMode | null; globalPermissionMode?: boolean } | null | undefined,
  profile: { permissionMode: PermissionMode | null } | null | undefined,
): PermissionMode | null {
  return inheritedDefault('permissionMode', project, profile);
}
