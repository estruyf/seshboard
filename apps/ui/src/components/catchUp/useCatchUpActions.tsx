import { useState, type ReactNode } from 'react';
import type { CatchUp, GitChanges, PermissionRequest } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { currentOrder } from '../../state/sessionNav.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { CommitDialog } from '../git/CommitDialog.tsx';
import { usePermissionAnswer } from '../session/PermissionCard.tsx';
import { nextAfterArchive, type CatchUpActionId, type CatchUpShow } from './catchUpModel.ts';

export interface CatchUpActions {
  run(id: CatchUpActionId): void;
  /** Dialogs the actions open (Commit). */
  overlays: ReactNode;
  /** What went wrong last, for a line under the card. */
  error: string | null;
  /** The open request a waiting card is about (the oldest), if any. */
  request: PermissionRequest | null;
  /** An answer to a question picked in the banner, by option label. */
  answer(label: string): void;
  busy: boolean;
}

/**
 * What the card's buttons and keys do. Review changes opens the Changes panel; Commit opens the Commit dialog; Reply puts
 * you in the message box; Mark as read and Archive change the session at once (so the focus counter follows) and tell
 * the engine; Expand conversation folds the card. Allow, Deny and an answer go through the permission card's own handler.
 */
export function useCatchUpActions({ card, show, cwd, changes, request }: { card: CatchUp; show: CatchUpShow; cwd: string | null; changes: GitChanges | null; request: PermissionRequest | null }): CatchUpActions {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessionId = card.sessionId;
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (what: string) => (e: unknown) => setError(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
  // A waiting card always has its request; this stand-in keeps the hook's order the same when it doesn't.
  const permission = usePermissionAnswer(request ?? STAND_IN);

  const run = (id: CatchUpActionId) => {
    setError(null);
    const store = useCatchUp.getState();
    switch (id) {
      case 'review':
        useOverlay.getState().toggleChanges();
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
        useSessions.getState().patchSummary(sessionId, { archivedAt: Date.now(), unread: false });
        void client?.call('sessions.setFlags', { sessionId, archived: true }).catch(fail('archive it'));
        const next = nextAfterArchive(order, sessionId);
        if (next) useSessions.getState().select(next);
        else useSessions.getState().goHome();
        return;
      }
      case 'expand':
        // In full it folds into the strip; from the strip it opens again.
        store.setCollapsed(card, show === 'full');
        return;
      case 'allow':
        if (request) void permission.allow();
        return;
      case 'deny':
        if (request) void permission.deny();
        return;
      case 'answer':
        // Answering takes a choice: the card shows the question in full.
        store.setCollapsed(card, false);
        return;
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

  return {
    run,
    overlays,
    error: error ?? (request ? permission.error : null),
    request,
    answer: (label) => {
      if (!request) return;
      const question = (request.input as { questions?: Array<{ question: string }> }).questions?.[0];
      if (question) void permission.answer({ [question.question]: label });
    },
    busy: permission.busy,
  };
}

/** Never answered: `usePermissionAnswer` only sends when its card's buttons are pressed. */
const STAND_IN: PermissionRequest = {
  requestId: '',
  sessionId: '',
  toolName: '',
  toolUseId: null,
  input: {},
  title: null,
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: 0,
};
