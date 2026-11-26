import type { ProjectInfo, ProjectOrder } from '@seshboard/protocol/client';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { addedProjects } from '../../state/projectList.ts';
import type { Choices } from '../newSession/choices.ts';
import { filterFolders, orderProjects, tileStatus, type ProjectActivity, type TileTone } from '../newSession/projectTiles.ts';
import type { MenuBarRow } from '../menuBar/menuBarModel.ts';

/**
 * Quick start (the panel the global shortcut opens, and the menu bar's new work): which projects it lists and in what
 * order, what the field holds, which options differ from the project's defaults, and what a failed start says. Pure,
 * for testing; `QuickStartPanel` draws it.
 */

/** One of your projects in the list, in New session's order, with its branch and what is going on in it. */
export interface QuickProject {
  root: string;
  name: string;
  /** The branch its latest session had checked out, or null (not a repository, or no session yet). */
  branch: string | null;
  tone: TileTone;
  /** What is going on in it: "1 working", "Idle · 2h". */
  label: string;
  /** "main · 1 working", "dev · Idle · 2h". */
  meta: string;
}

/**
 * Your projects (added, and still there) in the order New session lists them (Settings › Projects' order), filtered
 * by what was typed as New session's full list filters (`filterFolders`): the best matches first.
 */
export function quickStartProjects(input: {
  projects: Map<string, ProjectInfo>;
  activity: ReadonlyMap<string, ProjectActivity>;
  branches: ReadonlyMap<string, string | null>;
  order: ProjectOrder;
  filter: string;
  home: string | null;
  now: number;
}): QuickProject[] {
  const { projects, activity, branches } = input;
  const folders = addedProjects(projects)
    .filter((p) => p.exists)
    .map((p) => p.root);
  const ordered = orderProjects(folders, input.order, (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null);
  const nameOf = (root: string) => projects.get(root)?.name ?? root;
  return filterFolders(ordered, input.filter, nameOf, input.home).map((root) => {
    const status = tileStatus(activity.get(root), projects.get(root)?.lastActivity ?? null, input.now);
    const branch = branches.get(root) ?? null;
    return { root, name: nameOf(root), branch, tone: status.tone, label: status.label, meta: [branch, status.label].filter(Boolean).join(' · ') };
  });
}

/** What the quick question row is called, and what Find matches it by. */
export const QUESTION_ROW = { label: 'Quick question', detail: 'Ask without a project' } as const;

/** Something the first screen does before a project is picked. Its result waits in the draft for the project. */
export interface QuickAction {
  id: 'screenshot' | 'clear-images' | 'open-app' | 'last-session' | 'working' | 'review';
  label: string;
  detail: string;
  /** Open the last session: the session it opens. */
  sessionId?: string;
}

/** The sessions an action lists in the panel: the ones that work, or the finished ones not read yet. */
export type QuickList = 'working' | 'review';

/** A session as the sidebar lists it, as much as the last session needs. */
export interface QuickSessionRow {
  id: string;
  title: string;
  projectRoot: string;
  updatedAt: number;
  archivedAt: number | null;
  remote?: unknown;
}

/** The last session: the one on this computer that changed most recently, not in Done. */
export function lastSession<T extends QuickSessionRow>(rows: readonly T[]): T | null {
  let last: T | null = null;
  for (const row of rows) if (!row.remote && row.archivedAt === null && (!last || row.updatedAt > last.updatedAt)) last = row;
  return last;
}

const sessionsLabel = (count: number, what: string) => `${count} ${what}`;

/**
 * The first screen's actions. With nothing attached: Take a screenshot, Open Seshboard, Open the last
 * session, and the Working and To review lists when they have sessions. Once images are attached, only what works on
 * them: Take another screenshot and Remove all images, so several can go with one task and the draft can start again.
 */
export function quickActions(input: {
  canShoot: boolean;
  attached: number;
  last?: { id: string; title: string; project: string } | null;
  working?: number;
  review?: number;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  if (input.attached) {
    if (input.canShoot) actions.push({ id: 'screenshot', label: 'Take another screenshot', detail: 'Add it to the others' });
    actions.push({ id: 'clear-images', label: 'Remove all images', detail: sessionsLabel(input.attached, 'attached') });
    return actions;
  }
  if (input.canShoot) actions.push({ id: 'screenshot', label: 'Take a screenshot', detail: 'Attach it, then pick a project' });
  actions.push({ id: 'open-app', label: 'Open Seshboard', detail: 'Bring its window to the front' });
  if (input.last) actions.push({ id: 'last-session', label: 'Open the last session', detail: [input.last.title || 'Untitled session', input.last.project].filter(Boolean).join(' · '), sessionId: input.last.id });
  if (input.working) actions.push({ id: 'working', label: 'Working sessions', detail: sessionsLabel(input.working, 'working') });
  if (input.review) actions.push({ id: 'review', label: 'Sessions to review', detail: sessionsLabel(input.review, 'to review') });
  return actions;
}

/** A list's heading, and what its field says. */
export const LIST_TITLES: Record<QuickList, { title: string; placeholder: string }> = {
  working: { title: 'Working', placeholder: 'Find a working session…' },
  review: { title: 'To review', placeholder: 'Find a session to review…' },
};

/** The sessions of a list (Working, To review), filtered by what was typed, best matches first. */
export function quickListSection(list: QuickList, sessions: readonly MenuBarRow[], filter: string): QuickSection[] {
  const typed = filter.trim();
  const shown = typed
    ? sessions
        .map((session) => ({ session, score: fuzzyScore(typed, session.title) }))
        .filter((s): s is { session: MenuBarRow; score: number } => s.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.session)
    : [...sessions];
  return shown.length ? [{ id: list, title: LIST_TITLES[list].title, rows: shown.map((session) => ({ kind: 'session', id: `session:${session.id}`, session })) }] : [];
}

export type QuickRow =
  | { kind: 'action'; id: string; action: QuickAction }
  | { kind: 'needs-you'; id: string; session: MenuBarRow }
  /** A session in a list an action opened (Working, To review). */
  | { kind: 'session'; id: string; session: MenuBarRow }
  | { kind: 'project'; id: string; project: QuickProject; /** 1–9: ⌘1–⌘9 picks it. */ number: number | null }
  | { kind: 'question'; id: string };

export interface QuickSection {
  id: 'actions' | 'needs-you' | 'projects' | 'more' | QuickList;
  title: string;
  rows: QuickRow[];
}

/**
 * The first screen's sections: Actions (those that match what was typed), Needs you (when shown, and nothing is
 * typed), Projects (⌘1–⌘9 on the first nine), and More with Quick question (when there is a questions folder, and
 * what was typed matches it). Empty sections are left out.
 */
export function quickStartSections(input: { actions?: readonly QuickAction[]; needsYou: readonly MenuBarRow[]; showNeedsYou: boolean; projects: readonly QuickProject[]; filter: string; questions: boolean }): QuickSection[] {
  const typed = input.filter.trim();
  const sections: QuickSection[] = [];
  const actions = (input.actions ?? []).filter((action) => !typed || fuzzyScore(typed, action.label) !== null);
  if (actions.length) sections.push({ id: 'actions', title: 'Actions', rows: actions.map((action) => ({ kind: 'action', id: `action:${action.id}`, action })) });
  const waiting = input.showNeedsYou && !typed ? input.needsYou.filter((row) => row.section === 'needs-you') : [];
  if (waiting.length) sections.push({ id: 'needs-you', title: 'Needs you', rows: waiting.map((session) => ({ kind: 'needs-you', id: `session:${session.id}`, session })) });
  if (input.projects.length) {
    sections.push({ id: 'projects', title: 'Projects', rows: input.projects.map((project, i) => ({ kind: 'project', id: `project:${project.root}`, project, number: i < 9 ? i + 1 : null })) });
  }
  if (input.questions && (!typed || fuzzyScore(typed, QUESTION_ROW.label) !== null)) sections.push({ id: 'more', title: 'More', rows: [{ kind: 'question', id: 'question' }] });
  return sections;
}

/**
 * The row the list starts on: the first one (an action, when there are actions). While typing, or once something is
 * attached (a screenshot taken), the first project instead, since a project is what is wanted next.
 */
export function firstActive(rows: readonly QuickRow[], input: { typed: boolean; attached: boolean }): number {
  if (!input.typed && !input.attached) return 0;
  const project = rows.findIndex((row) => row.kind === 'project');
  return project >= 0 ? project : 0;
}

/** The row ↑ and ↓ move to, staying at the ends; Home and End go to the first and last. */
export function moveActive(count: number, current: number, key: string): number {
  if (count === 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return current;
  return Math.max(0, Math.min(count - 1, current + (key === 'ArrowDown' ? 1 : -1)));
}

/**
 * What the field holds. With no project picked it finds one (`query`); once one is picked, it is a token at the
 * start of the field and the field takes the task. The task stays when the token goes, so picking again brings it back.
 */
export interface QuickField {
  /** The picked project's root (the questions folder for a quick question), or null. */
  project: string | null;
  query: string;
  task: string;
}

export const EMPTY_FIELD: QuickField = { project: null, query: '', task: '' };

/** Picking a project: it becomes the token, and the field takes the task. */
export const pickProject = (field: QuickField, root: string): QuickField => ({ ...field, project: root, query: '' });

/** ⌫ with the caret at the start of the task takes the token away and goes back to the list; null otherwise. */
export function backspaceAtStart(field: QuickField, caret: { start: number; end: number }): QuickField | null {
  if (!field.project || caret.start !== 0 || caret.end !== 0) return null;
  return { ...field, project: null, query: '' };
}

/** How the token is announced. */
export const tokenLabel = (name: string): string => `Project: ${name}. Backspace to change.`;

/** The options under the field: who runs it, on what model and effort, in which mode, and where. */
export interface QuickOptions {
  profileId: string;
  model: string;
  effort: Choices['effort'];
  permissionMode: Choices['permissionMode'];
  workspace: Choices['workspace'];
}

const OPTION_KEYS = ['profileId', 'model', 'effort', 'permissionMode', 'workspace'] as const;

/** The options picked for this session that differ from what the project starts with. */
export function changedOptions(defaults: QuickOptions, current: QuickOptions): Array<keyof QuickOptions> {
  return OPTION_KEYS.filter((key) => defaults[key] !== current[key]);
}

/** The line on the right of the options: where they come from. */
export const optionsSource = (changed: boolean, projectName: string): string => (changed ? 'Changed for this session' : `From ${projectName}’s defaults`);

/** The "where" chip: the branch in this folder, or a new worktree. */
export function whereLabel(workspace: Choices['workspace'], branch: string | null): string {
  if (workspace === 'worktree') return 'New worktree';
  return branch ? `${branch}, this folder` : 'This folder';
}

/** The task's first line for the confirmation, cut at `max` characters. */
export function firstLine(task: string, max = 60): string {
  const line = task.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Why a start can't go ahead, and what fixes it. */
export interface StartProblem {
  message: string;
  fix: 'sign-in' | 'pick-project' | null;
}

/**
 * What a failed start says under the field (the draft stays): the folder is gone (pick another project), the profile
 * isn't signed in (Sign in), or the engine's own message.
 */
export function startProblem(input: { folderExists: boolean; projectName: string; signedIn: boolean; profileName: string; error?: string | null }): StartProblem | null {
  if (!input.folderExists) return { message: `${input.projectName}’s folder is gone.`, fix: 'pick-project' };
  if (!input.signedIn) return { message: `${input.profileName} isn’t signed in to Claude Code.`, fix: 'sign-in' };
  if (input.error) return { message: `Couldn’t start: ${input.error}`, fix: null };
  return null;
}
