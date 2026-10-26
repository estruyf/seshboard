import type { SessionRowData } from './sessionsStore.ts';
import type { SidebarSort } from '@seshboard/protocol/bridge';
import type { PipelineRunState } from '@seshboard/protocol/client';
import { sidebarForest } from './pipelineTree.ts';
import { treeRuns, usePipelineTree } from './pipelineTreeStore.ts';
import { buildSessionList, groupsFor, quickestGroups, rowStatus, type QuickInfo, type RowStatus, type SessionGroup } from './sidebarRows.ts';

/** A permission or question a session waits on, as far as the rail's tooltip and the needs-you pill care. */
export interface WaitingRequest {
  sessionId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

/**
 * The sidebar's sections and their sessions, in the order it lists them: Needs you, Working, Pinned, Today, Yesterday,
 * Earlier (Recent), or Needs review, Read, Still working (Quickest to unblock). Archived sessions are left out. The
 * minimal rail, ⌃⇥ and ⌘P all read this, so the order never differs between them.
 *
 * Pipelines (#179): run rows are listed, a parent sits where its most urgent child puts it, and sub-sessions follow
 * their parent only while it is open in the sidebar (`openParents`; the rail passes none). `runs` and `openParents`
 * default to this window's.
 */
export function sidebarGroups(
  rows: readonly SessionRowData[],
  options: {
    now: number;
    archiveAfterDays: number;
    search?: string;
    project?: string | null;
    sort?: SidebarSort;
    quick?: ReadonlyMap<string, QuickInfo>;
    runs?: Iterable<PipelineRunState>;
    openParents?: ReadonlySet<string>;
  },
): { group: SessionGroup; rows: SessionRowData[] }[] {
  const forest = sidebarForest(rows, options.runs ?? treeRuns(), options.now, options.archiveAfterDays);
  const { active } = buildSessionList(forest.roots, { search: options.search ?? '', project: options.project ?? null, now: options.now, archiveAfterDays: options.archiveAfterDays, children: forest.children });
  const open = options.openParents ?? usePipelineTree.getState().open;
  return groupsFor(active, options.now, options.sort, options.quick).map(({ group, rows: inGroup }) => ({ group, rows: withOpenChildren(inGroup, forest.children, open) }));
}

/** Rows with the sub-sessions of the open parents after each, as the open sidebar lists them. */
function withOpenChildren(rows: readonly SessionRowData[], children: ReadonlyMap<string, readonly SessionRowData[]>, open: ReadonlySet<string>, seen: Set<string> = new Set()): SessionRowData[] {
  if (open.size === 0) return [...rows];
  return rows.flatMap((row) => {
    const kids = open.has(row.id) && !seen.has(row.id) ? children.get(row.id) : undefined;
    if (!kids?.length) return [row];
    seen.add(row.id);
    const out = [row, ...withOpenChildren(kids, children, open, seen)];
    seen.delete(row.id);
    return out;
  });
}

/** The sessions of `sidebarGroups`, one after the other. */
export const sidebarOrder = (groups: readonly { rows: readonly SessionRowData[] }[]): SessionRowData[] => groups.flatMap((g) => g.rows);

/**
 * The session after (1) or before (-1) the current one, wrapping at the ends. Without a current session
 * in the list, the first (or, going back, the last). Null when there is nothing to go to.
 */
export function stepSession(order: readonly string[], currentId: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = currentId ? order.indexOf(currentId) : -1;
  if (index === -1) return direction === 1 ? order[0]! : order[order.length - 1]!;
  return order[(index + direction + order.length) % order.length]!;
}

/**
 * ⌘⇧U: the next session that needs you after the current one, in Quickest to unblock order whatever the sidebar shows
 * (waiting for you first, then finished and unread, quickest review first), wrapping. The current one when it is the
 * only one; null when nothing needs you.
 */
export function nextNeedsYou(rows: readonly SessionRowData[], currentId: string | null, quick: ReadonlyMap<string, QuickInfo> = new Map()): string | null {
  const needs = quickestGroups(rows, quick).find((g) => g.group === 'review')?.rows.map((row) => row.id) ?? [];
  if (needs.length === 0) return null;
  const index = currentId ? needs.indexOf(currentId) : -1;
  return needs[(index + 1) % needs.length]!;
}

/** When each waiting session started waiting: its oldest open request, else when it last changed. */
function waitingSince(row: SessionRowData, requests: Iterable<WaitingRequest>): number {
  let since = Infinity;
  for (const request of requests) if (request.sessionId === row.id && request.createdAt < since) since = request.createdAt;
  return since === Infinity ? row.updatedAt : since;
}

/**
 * The header's pill while the sidebar is closed: how many sessions need you ("1 needs you", "2 need you")
 * and the one waiting longest, which a click opens. Null when nothing waits.
 */
export function needsYouPill(rows: readonly SessionRowData[], requests: Iterable<WaitingRequest>): { count: number; label: string; targetId: string } | null {
  const list = [...requests];
  const waiting = rows.filter((row) => rowStatus(row) === 'needs-you');
  if (waiting.length === 0) return null;
  const oldest = waiting.reduce((best, row) => (waitingSince(row, list) < waitingSince(best, list) ? row : best));
  return { count: waiting.length, label: `${waiting.length} ${waiting.length === 1 ? 'needs' : 'need'} you`, targetId: oldest.id };
}

/** What a waiting request asks, in a few words: the question itself, a plan, or the tool. */
export function waitingDetail(request: Pick<WaitingRequest, 'toolName' | 'input'> | null): string | null {
  if (!request) return null;
  if (request.toolName === 'AskUserQuestion') {
    const questions = (request.input as { questions?: Array<{ question?: unknown }> } | null)?.questions;
    const question = Array.isArray(questions) ? questions[0]?.question : null;
    return typeof question === 'string' && question.trim() ? question.trim() : 'a question';
  }
  if (request.toolName === 'ExitPlanMode') return 'a plan to review';
  return `allow ${request.toolName}`;
}

/** The status colours, as text, for the rail's tooltip and the HUD. */
export type StatusTone = 'warn' | 'accent' | 'unread' | 'ok' | 'error' | 'faint';

/** A session's state as one line in its colour: "Needs you: which easing…", "Working", "Done, not read yet". */
export function statusLine(status: RowStatus, detail: string | null = null): { text: string; tone: StatusTone } | null {
  switch (status) {
    case 'needs-you':
      return { text: detail ? `Needs you: ${detail}` : 'Needs you', tone: 'warn' };
    case 'running':
      return { text: 'Working', tone: 'accent' };
    case 'unread':
      return { text: 'Done, not read yet', tone: 'unread' };
    case 'error':
      return { text: 'Last run failed', tone: 'error' };
    case 'background':
      return { text: 'A background task is running', tone: 'ok' };
    case 'idle':
      return { text: 'Open, idle', tone: 'faint' };
    default:
      return null;
  }
}
