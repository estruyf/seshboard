import type { CatchUp, PermissionRequest, ProjectInfo } from '@seshboard/protocol/client';
import { reviewLabel } from '../catchUp/catchUpModel.ts';
import { shortAge } from '../../lib/format.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';

/** The menu bar panel's sections, in the order they show: what needs you first, then what works, then what finished. */
export type MenuBarSection = 'needs-you' | 'working' | 'finished';

/** One row of the panel: a session, what it is doing, and (needs you) the prompt it waits on. */
export interface MenuBarRow {
  id: string;
  section: MenuBarSection;
  title: string;
  /** The line under the title: what it wants, how long it has worked and where, or the review hint and its age. */
  detail: string;
  /** The age on the right (working, finished). */
  age: string | null;
  projectRoot: string;
  /** The oldest prompt it waits on; Allow answers it. */
  request: PermissionRequest | null;
  /** A permission Allow can answer here (not a question or a plan, which need the session). */
  allowable: boolean;
}

/** How many finished, unread sessions the panel shows. */
export const FINISHED_SHOWN = 5;

/** What a waiting session wants, in a few words: "Wants to run npm test", "Has a question". */
export function wantsLabel(request: PermissionRequest | null): string {
  if (!request) return 'Waiting for you';
  if (request.toolName === 'AskUserQuestion') return 'Has a question';
  if (request.toolName === 'ExitPlanMode') return 'Has a plan for you';
  const command = request.input && typeof request.input === 'object' && !Array.isArray(request.input) ? (request.input as Record<string, unknown>).command : undefined;
  if (request.toolName === 'Bash' && typeof command === 'string' && command.trim()) return `Wants to run ${command.trim().split('\n')[0]}`;
  const title = request.title?.trim();
  if (title?.startsWith('Claude wants to ')) return `Wants to ${title.slice('Claude wants to '.length).replace(/[?.]$/, '')}`;
  return `Wants to use ${request.toolName}`;
}

/** Only a plain permission can be allowed from the panel: questions and plans need their answers in the session. */
export const canAllow = (request: PermissionRequest | null): boolean => !!request && request.toolName !== 'AskUserQuestion' && request.toolName !== 'ExitPlanMode';

/**
 * The panel's rows from the sidebar's rows (this computer's sessions, as the sidebar lists them), the open prompts and
 * the catch-ups. Needs you: a session waiting on a prompt. Working: one that runs. Finished, unread: the newest five
 * unread sessions that are done, with the catch-up's review hint. Archived and other computers' sessions stay out.
 */
export function menuBarRows(input: {
  rows: readonly SessionRowData[];
  permissions: Iterable<PermissionRequest>;
  catchUps: ReadonlyMap<string, CatchUp>;
  projectName: (root: string) => string;
  now: number;
}): MenuBarRow[] {
  const oldest = new Map<string, PermissionRequest>();
  for (const request of input.permissions) {
    const before = oldest.get(request.sessionId);
    if (!before || request.createdAt < before.createdAt) oldest.set(request.sessionId, request);
  }
  const local = input.rows.filter((row) => !row.remote && row.archivedAt === null);
  const title = (row: SessionRowData) => row.title || 'Untitled session';

  const needsYou = local
    .filter((row) => oldest.has(row.id) || row.live?.status === 'needs-you')
    .sort((a, b) => (oldest.get(a.id)?.createdAt ?? a.updatedAt) - (oldest.get(b.id)?.createdAt ?? b.updatedAt))
    .map((row): MenuBarRow => {
      const request = oldest.get(row.id) ?? null;
      return { id: row.id, section: 'needs-you', title: title(row), detail: wantsLabel(request), age: null, projectRoot: row.projectRoot, request, allowable: canAllow(request) };
    });
  const waiting = new Set(needsYou.map((row) => row.id));

  const working = local
    .filter((row) => !waiting.has(row.id) && row.live?.status === 'running')
    .map((row) => ({ row, since: row.workingSince ?? row.live?.startedAt ?? row.updatedAt }))
    .sort((a, b) => a.since - b.since)
    .map(({ row, since }): MenuBarRow => {
      const age = shortAge(since, input.now);
      return { id: row.id, section: 'working', title: title(row), detail: `${age} · ${input.projectName(row.projectRoot)}`, age, projectRoot: row.projectRoot, request: null, allowable: false };
    });

  const finished = local
    .filter((row) => row.unread && !waiting.has(row.id) && row.live?.status !== 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, FINISHED_SHOWN)
    .map((row): MenuBarRow => {
      const card = input.catchUps.get(row.id);
      const age = shortAge(row.updatedAt, input.now);
      return { id: row.id, section: 'finished', title: title(row), detail: card ? `${reviewLabel(card)} · ${age}` : `${input.projectName(row.projectRoot)} · ${age}`, age, projectRoot: row.projectRoot, request: null, allowable: false };
    });

  return [...needsYou, ...working, ...finished];
}

/** The section headings, as the panel shows them. */
export const SECTION_TITLES: Record<MenuBarSection, string> = { 'needs-you': 'Needs you', working: 'Working', finished: 'Finished, unread' };

/**
 * The projects New work can start in: the ones that exist (never the quick questions folder), most recently used
 * first, filtered by what was typed in Find.
 */
export function pickableProjects(projects: Iterable<ProjectInfo>, query: string, questionsDir: string | null): ProjectInfo[] {
  const usable = [...projects].filter((p) => p.exists && p.root !== questionsDir);
  const recent = usable.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.name.localeCompare(b.name));
  const q = query.trim();
  if (!q) return recent;
  return recent
    .map((project) => ({ project, score: Math.max(fuzzyScore(q, project.name) ?? -Infinity, (fuzzyScore(q, project.root) ?? -Infinity) - 1) }))
    .filter((entry) => entry.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.project);
}

/** The next row for ↑ and ↓ in the panel, staying at the ends. */
export function nextRow(count: number, current: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number {
  if (count === 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const next = current + (key === 'ArrowDown' ? 1 : -1);
  return Math.max(0, Math.min(count - 1, next));
}
