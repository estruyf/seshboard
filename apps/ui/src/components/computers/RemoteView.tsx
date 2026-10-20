import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { sameRemote, type RemoteRef } from '../../state/remoteSelection.ts';
import { ComputerView, type PaneProps } from './ComputerView.tsx';
import { RemoteSessionView } from './RemoteSessionView.tsx';

const NO_PROMPTS: never[] = [];

/** The main area's `remote` view: a computer's page. Its sessions open in panes (`RemotePane`). */
export function RemoteView() {
  const pageId = useComputers((s) => s.pageId);
  return <ComputerView computerId={pageId} />;
}

/**
 * A pane showing a session on another computer (its leaf in the layout is `remoteRowId`): the session, or its
 * computer's page while it is starting, the computer is away before the first list, or it is no longer listed there.
 */
export function RemotePane({ remote, pane }: { remote: RemoteRef; pane: PaneProps }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const starting = useComputers((s) => s.starting);
  const computer = useComputers((s) => s.status?.computers.find((c) => c.id === remote.computerId) ?? null);
  const list = useComputers((s) => s.lists.get(remote.computerId) ?? null);
  const session = list?.sessions.find((s) => s.id === remote.sessionId) ?? null;
  if (!client || !computer || !session) {
    const fresh = sameRemote(starting, remote);
    return <ComputerView computerId={remote.computerId} missing={!!computer && !!list && !fresh} starting={fresh} pane={pane} />;
  }
  const prompts = list?.prompts.filter((p) => p.sessionId === session.id) ?? NO_PROMPTS;
  return <RemoteSessionView key={`${computer.id}:${session.id}`} client={client} computer={computer} session={session} prompts={prompts} pane={pane} />;
}
