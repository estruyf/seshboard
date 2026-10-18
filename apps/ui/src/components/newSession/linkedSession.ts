import { linkLabel, uniqueLabel } from '@switchboard/protocol/client';
import { newDraftKey } from '../../state/drafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';

/**
 * New session linked to this one (session linking): New session on the session's project, with `@<its title>` in the
 * box and its chip in the tray, ready for "stack the PR on top of the one you opened in …".
 */
export function startLinkedSession(session: { id: string; title: string; projectRoot: string }): void {
  const key = newDraftKey(session.projectRoot);
  const drafts = useDrafts.getState();
  const linked = drafts.drafts[key]?.context?.filter((chip) => chip.kind === 'session') ?? [];
  if (!linked.some((chip) => chip.kind === 'session' && chip.sessionId === session.id)) {
    const label = uniqueLabel(linkLabel(session.title), linked.map((chip) => (chip as { label: string }).label));
    drafts.addContext(key, [{ kind: 'session', sessionId: session.id, label }]);
    // Goes at the end of what is there, as if typed, once New session shows this project's box.
    drafts.requestQuote(key, `@${label} `, { plain: true });
  }
  useProjects.getState().startIn(session.projectRoot);
  useSessions.getState().openNewSession();
  drafts.requestFocus(key);
}
