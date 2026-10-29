import type { Effort, PermissionMode } from '@seshboard/protocol/client';

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** One line per mode for the permission menu. */
export const MODE_DESCRIPTION: Partial<Record<PermissionMode, string>> = {
  default: 'Approve every edit and command',
  acceptEdits: 'File edits apply, commands still ask',
  plan: 'Read and plan, no changes',
  auto: 'Claude only asks when it matters',
};

/** The plain-language line under the route tray: where the edits of this session land. */
export function routeHint(route: { worktree: boolean; isGitRepo: boolean; branch: string | null; name: string }): string {
  if (route.worktree) return `Isolated in .claude/worktrees/${route.name || '<name>'} · your checkout stays untouched`;
  if (!route.isGitRepo) return 'Edits land directly in this folder (not a git repository)';
  return `Edits land directly in your working copy${route.branch ? ` on ${route.branch}` : ''}`;
}
