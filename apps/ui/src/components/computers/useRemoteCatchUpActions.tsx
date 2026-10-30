import { useState } from 'react';
import type { CatchUp, Computer, Contract, RpcClient } from '@seshboard/protocol/client';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import type { CatchUpActions } from '../catchUp/useCatchUpActions.tsx';
import { CommitDialog } from '../git/CommitDialog.tsx';
import { callComputer } from './callComputer.ts';
import { setRemoteFlags, setRemoteUnread } from './remoteActions.ts';
import type { RemoteChanges } from './RemoteChangesPanel.tsx';

/**
 * What the catch-up's buttons and keys do in a session on another computer, as `useCatchUpActions` does here: Review
 * changes opens its Changes panel, Commit commits there (`changes.commit`, never a push), Reply puts you in its message
 * box, Mark as read and Archive change it there.
 */
export function useRemoteCatchUpActions({
  card,
  client,
  computer,
  draftKey,
  changes,
  changesOpen,
  onChanges,
  onCommitted,
}: {
  card: CatchUp | null;
  client: RpcClient<Contract>;
  computer: Pick<Computer, 'id' | 'name'>;
  draftKey: string;
  changes: RemoteChanges | null;
  changesOpen: boolean;
  onChanges(open: boolean): void;
  onCommitted(): void;
}): CatchUpActions {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = card?.sessionId ?? '';

  const run: CatchUpActions['run'] = (id) => {
    setError(null);
    switch (id) {
      case 'review':
        return onChanges(!changesOpen);
      case 'commit':
        return setCommitting(true);
      case 'reply':
        return useDrafts.getState().requestFocus(draftKey);
      case 'read':
        return setRemoteUnread(client, computer.id, sessionId, false);
      case 'archive':
        setRemoteFlags(client, computer.id, sessionId, { archived: true, pinned: false });
        useSessions.getState().goHome();
        return;
    }
  };

  const overlays =
    committing && card ? (
      <CommitDialog
        branch={changes?.branch ?? null}
        files={changes?.files.length ?? card.signals.diff?.files ?? 0}
        onCommit={async (message) => {
          const result = await callComputer(client, computer.id, 'changes.commit', { sessionId, message });
          if (!result.ok) throw new Error(result.output || `The commit did not go through on ${computer.name}.`);
          useCatchUp.getState().markCommitted(card);
          onCommitted();
        }}
        onClose={() => setCommitting(false)}
      />
    ) : null;

  return { run, fold: (collapsed) => card && useCatchUp.getState().setCollapsed(card, collapsed), overlays, error };
}
