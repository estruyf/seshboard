import { useRef, useState } from 'react';
import { Link2, Monitor } from 'lucide-react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { ConfirmStrip, ConnectedNow, dangerQuiet, ListRow } from '../remote/RemoteRows.tsx';
import { remoteAge } from '../remote/remoteText.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { computerLine } from './computerSessions.ts';

const field = 'h-7 min-w-0 flex-1 rounded-md border border-edge bg-card px-2 font-mono text-ui text-text placeholder:text-faint';

/**
 * Settings › Remote, Other computers: the computers this one paired with, in the same rows as the paired devices
 * (Open shows its sessions, Remove forgets it here), then the field for the link from another computer's Pair a
 * device. It also takes a link from Reconnect a paired device, for a computer whose quick tunnel got a new address.
 */
export function ComputersSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const status = useComputers((s) => s.status);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  if (!status || !client) return <p className="text-ui text-muted">Checking…</p>;
  if (!status.available) return <Notice>Other computers aren't available in this build of Switchboard.</Notice>;
  const { pairing, computers } = status;

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
            <ListRow
              key={computer.id}
              attrs={{ 'data-computer': computer.id }}
              icon={<Monitor size={16} aria-hidden />}
              name={computer.name}
              status={
                <>
                  {computer.state === 'connected' ? <ConnectedNow /> : computerLine(computer)}
                  {` · paired ${remoteAge(computer.pairedAt)}`}
                </>
              }
              actions={
                <>
                  {computer.state === 'offline' && (
                    <Button size="sm" variant="quiet" onClick={() => void client.call('computers.retry', { id: computer.id })}>
                      Try again
                    </Button>
                  )}
                  <Button size="sm" variant="quiet" onClick={() => useComputers.getState().open(computer.id)} data-computer-open>
                    Open
                  </Button>
                  <Button ref={(el) => void removeButtons.current.set(computer.id, el)} size="sm" variant="quiet" className={dangerQuiet} aria-expanded={removing === computer.id} onClick={() => setRemoving(computer.id)} data-computer-forget>
                    Remove
                  </Button>
                </>
              }
              confirm={
                removing === computer.id && (
                  <ConfirmStrip
                    question={`Remove ${computer.name}? Its sessions leave this computer. To pair again, paste a new link.`}
                    action="Remove"
                    returnTo={{ current: removeButtons.current.get(computer.id) ?? null }}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => {
                      setRemoving(null);
                      void client.call('computers.forget', { id: computer.id }).catch((e: Error) => setError(e.message));
                    }}
                  />
                )
              }
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
        <Notice actions={<Button size="sm" onClick={() => void client.call('computers.cancelPairing', {})}>Cancel</Button>} data-computers-code>
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
