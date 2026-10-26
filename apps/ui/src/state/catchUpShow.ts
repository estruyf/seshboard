import type { CatchUp, LiveSession, PermissionRequest, SessionHostInfo, SessionSummary } from '@seshboard/protocol/client';
import { catchUpShow, type CatchUpShow } from '../components/catchUp/catchUpModel.ts';
import { turnKey, useCatchUp } from './catchUpStore.ts';
import { HOST_TO_LIVE, isActiveHost, useHosts } from './hostsStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useSessions } from './sessionsStore.ts';

export interface ShowInputs {
  card: CatchUp | null;
  /** Settings › Conversation: "Write catch-up summaries with Haiku". */
  enabled: boolean;
  /** Settings › Conversation: "Show catch-ups folded". */
  folded: boolean;
  summary: SessionSummary | null;
  host: SessionHostInfo | undefined;
  live: LiveSession | null;
  permissions: Iterable<PermissionRequest>;
  collapsed: ReadonlyMap<string, boolean>;
}

/** How a session's catch-up shows, from what the stores know about it (see `catchUpShow`). */
export function showOf({ card, enabled, folded, summary, host, live, permissions, collapsed }: ShowInputs): CatchUpShow {
  if (!card) return null;
  const status = isActiveHost(host) ? HOST_TO_LIVE[host.state] : live?.status;
  const waiting = [...permissions].some((p) => p.sessionId === card.sessionId);
  return catchUpShow(card, { enabled, folded, unread: summary?.unread ?? false, working: status === 'running', waiting, collapsed: collapsed.get(turnKey(card)) ?? null });
}

/** The session's catch-up and how it shows now. */
export function useCatchUpShow(sessionId: string | null): { card: CatchUp | null; show: CatchUpShow } {
  const card = useCatchUp((s) => (sessionId ? (s.cards.get(sessionId) ?? null) : null));
  const collapsed = useCatchUp((s) => s.collapsed);
  const enabled = usePreferences((s) => s.prefs.catchUpSummaries);
  const folded = usePreferences((s) => s.prefs.catchUpFolded);
  const summary = useSessions((s) => (sessionId ? (s.sessions.get(sessionId) ?? null) : null));
  const live = useSessions((s) => (sessionId ? (s.live.get(sessionId) ?? null) : null));
  const host = useHosts((s) => (sessionId ? s.hosts.get(sessionId) : undefined));
  const permissions = useHosts((s) => s.permissions);
  return { card, show: showOf({ card, enabled, folded, summary, host, live, permissions: permissions.values(), collapsed }) };
}
