import type { PermissionMode } from './host.ts';

/**
 * The permission mode a new session in a project inherits, before the session's own choice: the project's, else
 * its Claude profile's. A project can skip its profile's (`globalPermissionMode`). Null means neither sets one, so
 * the session starts in the global mode (Settings › General › Global permission mode).
 */
export function inheritedPermissionMode(
  project: { permissionMode: PermissionMode | null; globalPermissionMode?: boolean } | null | undefined,
  profile: { permissionMode: PermissionMode | null } | null | undefined,
): PermissionMode | null {
  if (project?.permissionMode) return project.permissionMode;
  if (project?.globalPermissionMode) return null;
  return profile?.permissionMode ?? null;
}
