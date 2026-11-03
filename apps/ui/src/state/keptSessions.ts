import { useMemo } from 'react';
import type { LaterItem } from '@seshboard/protocol/client';
import { sessionsWithDrafts, type Draft } from './drafts.ts';
import { useDrafts } from './draftsStore.ts';
import { useLater } from './laterStore.ts';
import { useLooseEnds } from './looseEndsStore.ts';

const withDrafts = (drafts: Readonly<Record<string, Draft>>) => sessionsWithDrafts(Object.keys(drafts), drafts);
const withQueued = (items: readonly LaterItem[]) => items.flatMap((item) => (item.waitFor.kind === 'session' ? [item.waitFor.sessionId] : []));

/**
 * The sessions with an unsent message or a queued prompt, which the sidebar keeps listed whatever their age (`keep` in
 * the archive rule). The engine applies the same rule for the VS Code companion and the phone.
 */
export function useKeptSessions(): ReadonlySet<string> {
  // The ids joined: a string only changes when the set does, not on every keystroke in a draft.
  const drafts = useDrafts((s) => withDrafts(s.drafts).sort().join('\n'));
  const later = useLater((s) => s.items);
  // Loose ends in git or on GitHub keep a session listed too (never Done by inactivity).
  const loose = useLooseEnds((s) => s.byOwner);
  return useMemo(() => new Set([...(drafts ? drafts.split('\n') : []), ...withQueued(later), ...loose.keys()]), [drafts, later, loose]);
}

/** The same, read once (outside React). */
export const keptSessionsNow = (): ReadonlySet<string> => new Set([...withDrafts(useDrafts.getState().drafts), ...withQueued(useLater.getState().items), ...useLooseEnds.getState().byOwner.keys()]);
