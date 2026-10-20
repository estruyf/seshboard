import type { RemotePrompt, RemoteSession } from '@switchboard/protocol/remote-client';

/** The chips over the list: everything, what needs you, what works. */
export type ListFilter = 'all' | 'needs-you' | 'working';

export interface FilterCounts {
  needsYou: number;
  working: number;
}

export function filterCounts(sessions: readonly RemoteSession[]): FilterCounts {
  return {
    needsYou: sessions.filter((s) => s.status === 'needs-you').length,
    working: sessions.filter((s) => s.status === 'working').length,
  };
}

/** A chip with nothing in it is hidden; All always shows. A hidden chip that was on falls back to All. */
export function visibleFilter(filter: ListFilter, counts: FilterCounts): ListFilter {
  if (filter === 'needs-you' && counts.needsYou === 0) return 'all';
  if (filter === 'working' && counts.working === 0) return 'all';
  return filter;
}

/** True when every word of the search is in the title, the project's name or the branch. */
export function matchesSearch(session: RemoteSession, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${session.title} ${session.projectName} ${session.branch ?? ''}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * What the list shows for a chip and a search: the prompts as cards at the top (oldest first), and the sessions for
 * the groups below them. A session whose prompt has a card isn't a row too.
 */
export function filterList<S extends RemoteSession, P extends RemotePrompt>(list: { sessions: readonly S[]; prompts: readonly P[] }, filter: ListFilter, query: string) {
  const sessions = list.sessions.filter((s) => matchesSearch(s, query) && (filter === 'all' || s.status === filter));
  const shown = new Set(sessions.map((s) => s.id));
  const prompts = filter === 'working' ? [] : list.prompts.filter((p) => shown.has(p.sessionId)).sort((a, b) => a.createdAt - b.createdAt);
  const carded = new Set(prompts.map((p) => p.sessionId));
  return { prompts, sessions: sessions.filter((s) => !carded.has(s.id)) };
}
