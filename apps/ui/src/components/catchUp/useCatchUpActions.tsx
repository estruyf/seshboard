import { useState, type ReactNode } from 'react';
import type { CatchUp, GitChanges } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { closeChanges, isChangesOpen, openChanges } from '../../state/changesPanelStore.ts';
import { popoutSession } from '../../state/popoutsStore.ts';
import { currentOrder } from '../../state/sessionNav.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { CommitDialog } from '../git/CommitDialog.tsx';
import { nextAfterArchive, type CatchUpActionId } from './catchUpModel.ts';
import { archiveTree } from '../pipelines/RunTreeDialogs.tsx';

export interface CatchUpActions {
  run(id: CatchUpActionId): void;
  /** Folds the banner into the strip (true), or opens it from there (false). */
  fold(collapsed: boolean): void;
  /** Dialogs the actions open (Commit). */
  overlays: ReactNode;
  /** What went wrong last, for a line under the banner. */
  error: string | null;
}

/**
 * What the catch-up's buttons and keys do. Review changes opens the Changes panel; Commit opens the Commit dialog; Reply
 * puts you in the message box; Mark as read and Archive change the session at once (so the focus counter follows) and
 * tell the engine.
 */
export function useCatchUpActions({ card, cwd, changes }: { card: CatchUp; cwd: string | null; changes: GitChanges | null }): CatchUpActions {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessionId = card.sessionId;
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (what: string) => (e: unknown) => setError(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);

  const run = (id: CatchUpActionId) => {
    setError(null);
    const store = useCatchUp.getState();
    switch (id) {
      case 'review':
        if (isChangesOpen(sessionId)) closeChanges(sessionId);
        else openChanges(sessionId);
        return;
      case 'commit':
        if (!cwd) return setError('The folder for this session is unknown.');
        setCommitting(true);
        return;
      case 'reply':
        store.setReplying(sessionId);
        useDrafts.getState().requestFocus(sessionId);
        return;
      case 'read':
        useSessions.getState().patchSummary(sessionId, { unread: false, viewedAt: Date.now() });
        void client?.call('sessions.markViewed', { sessionId }).catch(fail('mark it as read'));
        return;
      case 'archive': {
        // The next session in the sidebar's order, worked out before this one leaves it.
        const order = currentOrder().map((row) => row.id);
        // The parent of a pipeline run archives with its sub-sessions (asking first while the run goes on).
        if (!archiveTree(sessionId, true, useSessions.getState().sessions.get(sessionId)?.title ?? '')) {
          useSessions.getState().patchSummary(sessionId, { archivedAt: Date.now(), unread: false });
          void client?.call('sessions.setFlags', { sessionId, archived: true }).catch(fail('archive it'));
        }
        const next = nextAfterArchive(order, sessionId);
        // A pop-out shows this one session: archived, its window closes (the next one would open in the main window).
        if (next && !popoutSession) useSessions.getState().select(next);
        else useSessions.getState().goHome();
        return;
      }
    }
  };

  const overlays =
    committing && cwd ? (
      <CommitDialog
        branch={changes?.branch ?? null}
        files={changes?.files.length ?? card.signals.diff?.files ?? 0}
        onCommit={async (message) => {
          if (!client) throw new Error('Not connected to the engine');
          const { terminalId } = await client.call('git.commit', { sessionId, cwd, message });
          useTerminals.getState().togglePanel(sessionId, true);
          useTerminals.getState().setActive(sessionId, terminalId);
          useCatchUp.getState().markCommitted(card);
        }}
        onClose={() => setCommitting(false)}
      />
    ) : null;

  return { run, fold: (collapsed) => useCatchUp.getState().setCollapsed(card, collapsed), overlays, error };
}
