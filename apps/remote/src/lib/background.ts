import type { BackgroundTask, RemoteSession } from '@switchboard/protocol/remote-client';

/**
 * What a session keeps running after its turn, in the desktop's words (apps/ui `backgroundTasks.ts`), so a session in
 * the background reads the same on both. Pure, with tests.
 */

export type BackgroundKind = 'shell' | 'agent' | 'workflow' | 'monitor' | 'tool' | 'other';

const KINDS: Record<string, BackgroundKind> = {
  local_bash: 'shell',
  local_agent: 'agent',
  remote_agent: 'agent',
  local_workflow: 'workflow',
  monitor: 'monitor',
  mcp_task: 'tool',
};

export const KIND_LABEL: Record<BackgroundKind, string> = {
  shell: 'Shell command',
  agent: 'Agent',
  workflow: 'Workflow',
  monitor: 'Monitor',
  tool: 'MCP tool',
  other: 'Task',
};

/** Unknown types (Claude Code adds new ones) read as a plain task rather than a raw id. */
export const backgroundKind = (type: string): BackgroundKind => KINDS[type] ?? 'other';

/** The pill's label: how many tasks run, and what they are when they're all the same kind. */
export function backgroundSummary(tasks: readonly Pick<BackgroundTask, 'type'>[]): string {
  const n = tasks.length;
  const kinds = new Set(tasks.map((t) => backgroundKind(t.type)));
  if (kinds.size === 1) {
    const kind = [...kinds][0]!;
    if (kind === 'shell') return n === 1 ? '1 background command' : `${n} background commands`;
    if (kind === 'agent') return n === 1 ? '1 background agent' : `${n} background agents`;
  }
  return n === 1 ? '1 background task' : `${n} background tasks`;
}

/**
 * Its turn ended but something it started still runs: Claude carries on when that finishes, so the session is still at
 * work and its catch-up waits. Also while it is unread (the status says unread first, as in the sidebar). A Switchboard
 * from before phones knew the tasks only says so through the status.
 */
export function inBackground(session: Pick<RemoteSession, 'status' | 'background'> | null): boolean {
  if (!session || session.status === 'working' || session.status === 'needs-you') return false;
  return session.status === 'background' || Boolean(session.background?.length);
}

/** The line at the end of the conversation while it runs in the background: what runs, when the computer says. */
export const backgroundLine = (tasks: readonly Pick<BackgroundTask, 'type'>[] | undefined): string => (tasks?.length ? `${backgroundSummary(tasks)} running` : 'Running in the background');
