import { useState } from 'react';
import { Link2 } from 'lucide-react';
import type { ComputerColor, ComputerNotify } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { ComputerRow } from './ComputerRow.tsx';

const field = 'h-7 min-w-0 flex-1 rounded-md border border-edge bg-card px-2 font-mono text-ui text-text placeholder:text-faint';

/**
 * Settings › Remote, Other computers: the computers this one paired with (`ComputerRow`: its version and updater,
 * Update when it is behind, the notifications choice, Open and ⋯ with the rest), then the field for the link from
 * another computer's Pair a device. It also takes a link from Reconnect a paired device, for a computer whose quick
 * tunnel got a new address.
 */
export function ComputersSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const status = useComputers((s) => s.status);
  const lists = useComputers((s) => s.lists);
  // Notifications in a computer's chip menu opens here at it: its row opens the choice.
  const notifyFor = useComputers((s) => s.notifyFor);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!status || !client) return <p className="text-ui text-muted">Checking…</p>;
  if (!status.available) return <Notice>Other computers aren't available in this build of Seshboard.</Notice>;
  const { pairing, computers } = status;

  const update = (id: string, changes: { name?: string; color?: ComputerColor; notify?: ComputerNotify }) => {
    setError(null);
    void client.call('computers.update', { id, ...changes }).catch((e: Error) => setError(e.message));
  };

  const add = () => {
    setError(null);
    void client.call('computers.add', { link: link.trim() }).then(
      () => setLink(''),
      (e: Error) => setError(e.message),
    );
  };

  return (
    <div className="grid gap-3" data-computers-settings>
      {computers.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" data-computers-list>
          {computers.map((computer) => (
            <ComputerRow
              key={computer.id}
              computer={computer}
              client={client}
              list={lists.get(computer.id) ?? null}
              notifyOpen={notifyFor === computer.id}
              onNotifyShown={() => useComputers.getState().clearNotifyFor()}
              onChange={(changes) => update(computer.id, changes)}
              onError={setError}
            />
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (link.trim()) add();
        }}
      >
        <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste the link from the other computer" spellCheck={false} aria-label="Link from the other computer" className={field} data-computers-link />
        <Button type="submit" icon={<Link2 size={13} aria-hidden />} disabled={!link.trim() || pairing?.state === 'connecting' || pairing?.state === 'waiting'} data-computers-add>
          Connect
        </Button>
      </form>
      <p className="text-meta text-muted">On the other computer: turn Remote on, click Pair a device, then Copy link.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {pairing?.state === 'connecting' && <Notice>Connecting to the other computer…</Notice>}
      {pairing?.state === 'waiting' && (
        <Notice actions={<Button variant="danger" size="sm" onClick={() => void client.call('computers.cancelPairing', {})}>Cancel</Button>} data-computers-code>
          Click Allow on the other computer if it shows <span className="font-mono font-semibold tracking-widest tabular-nums">{pairing.code}</span>.
        </Notice>
      )}
      {pairing?.state === 'failed' && (
        <Notice tone="error" onDismiss={() => void client.call('computers.cancelPairing', {})}>
          {pairing.message}
        </Notice>
      )}
    </div>
  );
}
