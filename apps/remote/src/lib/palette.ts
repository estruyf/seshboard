import type { RemoteProject, RemoteSession } from '@seshboard/protocol/remote-client';

/**
 * The ⌘K palette's matching and ranking. Pure, with tests: a fuzzy match on the title, the project and the branch,
 * sessions that need you first when the scores tie, then the most recent.
 */

/**
 * How well `query` matches `text`, or null when its letters aren't all in it, in order. A run of letters, the start of
 * a word and the start of the text count more; a long text that only just matches counts less.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  if (!needle) return 0;
  const exact = hay.indexOf(needle);
  if (exact >= 0) return 100 + needle.length * 4 - exact - (exact === 0 || /[\s/._-]/.test(hay[exact - 1]!) ? 0 : 20) - hay.length / 100;
  let score = 0;
  let at = 0;
  let run = 0;
  for (const char of needle) {
    const found = hay.indexOf(char, at);
    if (found < 0) return null;
    run = found === at ? run + 1 : 0;
    score += 1 + run * 2 + (found === 0 || /[\s/._-]/.test(hay[found - 1]!) ? 3 : 0) - Math.min(3, found - at) * 0.5;
    at = found + 1;
  }
  return score - hay.length / 100;
}

/** Every word of the query must match the title, the project or the branch; the title weighs most. */
export function sessionScore(session: Pick<RemoteSession, 'title' | 'projectName' | 'branch'>, query: string): number | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let total = 0;
  for (const word of words) {
    const scores = [fuzzyScore(word, session.title), scaled(fuzzyScore(word, session.projectName), 0.8), scaled(session.branch ? fuzzyScore(word, session.branch) : null, 0.7)].filter((s): s is number => s !== null);
    if (!scores.length) return null;
    total += Math.max(...scores);
  }
  return total;
}

const scaled = (score: number | null, by: number) => (score === null ? null : score * by);

/** Rounds away the tiny differences, so "ties" are ties a person would see. */
const bucket = (score: number) => Math.round(score);

/** Sessions that match, best first; needs you first when the scores tie, then the most recent. */
export function rankSessions<S extends Pick<RemoteSession, 'title' | 'projectName' | 'branch' | 'status' | 'updatedAt'>>(sessions: readonly S[], query: string): S[] {
  return sessions
    .map((session) => ({ session, score: sessionScore(session, query) }))
    .filter((s): s is { session: S; score: number } => s.score !== null)
    .sort((a, b) => bucket(b.score) - bucket(a.score) || Number(b.session.status === 'needs-you') - Number(a.session.status === 'needs-you') || b.session.updatedAt - a.session.updatedAt)
    .map((s) => s.session);
}

export type PaletteItem<S extends RemoteSession = RemoteSession, P extends RemoteProject = RemoteProject> =
  | { kind: 'session'; id: string; session: S }
  | { kind: 'start'; id: string; project: P }
  | { kind: 'action'; id: string; title: string };

export interface PaletteGroup<S extends RemoteSession = RemoteSession, P extends RemoteProject = RemoteProject> {
  label: 'Sessions' | 'Start' | 'Actions';
  items: PaletteItem<S, P>[];
}

/** The most sessions the palette lists; the rest are a few letters away. */
export const PALETTE_SESSIONS = 8;
const PALETTE_PROJECTS = 5;

/**
 * What the palette shows for a query: Sessions, Start ("New session in <project>" for each project that matches) and
 * Actions, empty groups left out. `actions` are the ones that make sense right now.
 */
export function paletteGroups<S extends RemoteSession, P extends RemoteProject>(input: { sessions: readonly S[]; projects: readonly P[]; actions: ReadonlyArray<{ id: string; title: string }>; query: string }): PaletteGroup<S, P>[] {
  const query = input.query.trim();
  const sessions = rankSessions(input.sessions, query).slice(0, PALETTE_SESSIONS);
  const projects = input.projects
    .map((project) => ({ project, score: query ? fuzzyScore(query, project.name) : 0 }))
    .filter((p): p is { project: P; score: number } => p.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, query ? PALETTE_PROJECTS : 3);
  const actions = input.actions
    .map((action) => ({ action, score: query ? fuzzyScore(query, action.title) : 0 }))
    .filter((a): a is { action: { id: string; title: string }; score: number } => a.score !== null)
    .sort((a, b) => (query ? b.score - a.score : 0));
  const groups: PaletteGroup<S, P>[] = [
    { label: 'Sessions', items: sessions.map((session) => ({ kind: 'session', id: `session:${session.id}`, session })) },
    { label: 'Start', items: projects.map(({ project }) => ({ kind: 'start', id: `start:${project.id}`, project })) },
    { label: 'Actions', items: actions.map(({ action }) => ({ kind: 'action', id: `action:${action.id}`, title: action.title })) },
  ];
  return groups.filter((group) => group.items.length > 0);
}
