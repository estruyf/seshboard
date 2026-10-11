import { isSameOrInside } from '@switchboard/protocol/paths';
import type { CompanionSession, CompanionSessions, CompanionStatus } from '@switchboard/protocol/companion-client';

/** Which session context goes to, and what the status bar says. Pure, so it can be tested. */

/** `path` is `folder` or inside it; on Windows without regard to case or slash (VS Code says `c:\`, Claude Code `C:\`). */
export const isWithin = (path: string, folder: string) => isSameOrInside(path, folder);

/**
 * The session focused in Switchboard, when its folder holds every path (or, for text that isn't from a file, the
 * workspace folder). Otherwise null: ask which session.
 */
export function focusedTarget(snapshot: CompanionSessions, paths: readonly string[]): CompanionSession | null {
  const focused = snapshot.focused;
  if (!focused?.cwd || paths.length === 0) return null;
  return paths.every((path) => isWithin(path, focused.cwd!)) ? focused : null;
}

/** The workspace folder a path is in (the deepest, for nested folders); null outside every one. */
export function folderFor(path: string, folders: readonly string[]): string | null {
  return folders.filter((folder) => isWithin(path, folder)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export const STATUS_LABEL: Record<CompanionStatus, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  background: 'Running in the background',
  error: 'Failed',
  unread: 'Unread',
  idle: 'Idle',
  stopped: '',
};

/** The codicon before a session in the quick pick. */
export const STATUS_ICON: Record<CompanionStatus, string> = {
  'needs-you': '$(bell-dot)',
  working: '$(loading~spin)',
  background: '$(sync)',
  error: '$(error)',
  unread: '$(circle-filled)',
  idle: '$(circle-outline)',
  stopped: '$(history)',
};

/** "5m", "3h", "2d": how long ago, the way Switchboard's sidebar says it. */
export function shortAge(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * A quick pick row for a session: the title with its status icon, then status, branch and age. Its folder goes on a
 * second line only when it isn't the workspace folder itself (`relative` returns '' for that).
 */
export function sessionRow(session: CompanionSession, now: number, relative: (path: string) => string): { label: string; description: string; detail?: string } {
  const folder = relative(session.cwd ?? session.projectRoot);
  return {
    label: `${STATUS_ICON[session.status]} ${session.title}`,
    description: [STATUS_LABEL[session.status], session.branch, shortAge(session.updatedAt, now)].filter(Boolean).join(' · '),
    ...(folder ? { detail: folder } : {}),
  };
}

export interface StatusBarView {
  text: string;
  tooltip: string;
  /** Pink like "Needs you" in Switchboard. */
  warning: boolean;
  /** The session a click shows; null opens the session list. */
  reveal: string | null;
}

/** The status bar item: what needs you in this workspace first, then what is working. */
export function statusBarView(snapshot: CompanionSessions | null): StatusBarView {
  if (!snapshot) return { text: '$(circle-slash) Switchboard', tooltip: "Switchboard isn't running. Click to open it.", warning: false, reveal: null };
  const needsYou = snapshot.sessions.filter((s) => s.status === 'needs-you');
  const working = snapshot.sessions.filter((s) => s.status === 'working').length;
  if (needsYou.length) {
    const first = needsYou[0]!;
    return {
      text: `$(bell-dot) Switchboard: ${needsYou.length} needs you`,
      tooltip: `${needsYou.map((s) => s.title).join('\n')}\n\nClick to show ${needsYou.length === 1 ? 'it' : `"${first.title}"`} in Switchboard.`,
      warning: true,
      reveal: first.id,
    };
  }
  if (working) return { text: `$(loading~spin) Switchboard: ${working} working`, tooltip: 'Click to see the sessions for this workspace.', warning: false, reveal: null };
  return { text: '$(comment-discussion) Switchboard', tooltip: 'Click to see the sessions for this workspace.', warning: false, reveal: null };
}
