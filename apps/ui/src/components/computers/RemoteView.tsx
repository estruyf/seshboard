import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { sameRemote } from '../../state/remoteSelection.ts';
import { ComputerView } from './ComputerView.tsx';
import { RemoteSessionView } from './RemoteSessionView.tsx';

const NO_PROMPTS: never[] = [];

/** The main area's `remote` view: the remote session that is open, or a computer's page. */
export function RemoteView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const selected = useComputers((s) => s.selected);
  const pageId = useComputers((s) => s.pageId);
  const starting = useComputers((s) => s.starting);
  const computer = useComputers((s) => (selected ? (s.status?.computers.find((c) => c.id === selected.computerId) ?? null) : null));
  const list = useComputers((s) => (selected ? (s.lists.get(selected.computerId) ?? null) : null));
  const session = selected ? (list?.sessions.find((s) => s.id === selected.sessionId) ?? null) : null;
  if (!selected) return <ComputerView computerId={pageId} />;
  if (!client || !computer || !session) {
    const fresh = sameRemote(starting, selected);
    return <ComputerView computerId={selected.computerId} missing={!!computer && !!list && !fresh} starting={fresh} />;
  }
  const prompts = list?.prompts.filter((p) => p.sessionId === session.id) ?? NO_PROMPTS;
  return <RemoteSessionView key={`${computer.id}:${session.id}`} client={client} computer={computer} session={session} prompts={prompts} />;
}
