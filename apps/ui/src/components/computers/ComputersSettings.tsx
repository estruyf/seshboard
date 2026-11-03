import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Link2, Monitor, Pencil } from 'lucide-react';
import { COMPUTER_COLORS, COMPUTER_NOTIFY, type Computer, type ComputerColor, type ComputerNotify } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { ConfirmStrip, ConnectedNow, ListRow, RenameField } from '../remote/RemoteRows.tsx';
import { remoteAge } from '../remote/remoteText.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { COMPUTER_COLOR_NAME, COMPUTER_COLOR_VAR, computerTint } from './computerColor.ts';
import { computerLine } from './computerSessions.ts';

const field = 'h-7 min-w-0 flex-1 rounded-md border border-edge bg-card px-2 font-mono text-ui text-text placeholder:text-faint';

/**
 * Settings › Remote, Other computers: the computers this one paired with, in the same rows as the paired devices
 * (Rename and Colour change how it shows here only, the bell picks which of its notifications show, Open shows its sessions, Remove forgets it here), then the field for the link from another computer's Pair a
 * device. It also takes a link from Reconnect a paired device, for a computer whose quick tunnel got a new address.
 */
export function ComputersSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const status = useComputers((s) => s.status);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [colouring, setColouring] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement | null>());
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
            <ListRow
              key={computer.id}
              attrs={{ 'data-computer': computer.id, 'data-computer-state': computer.state }}
              icon={
                <span className="flex text-remote" style={computerTint(computer.color)} data-computer-color={computer.color}>
                  <Monitor size={16} aria-hidden />
                </span>
              }
              name={
                renaming === computer.id ? (
                  <RenameField
                    name={computer.name}
                    label={`Name of ${computer.name}`}
                    clearable
                    placeholder={computer.ownName}
                    onCancel={() => setRenaming(null)}
                    onSave={(name) => {
                      setRenaming(null);
                      update(computer.id, { name });
                    }}
                  />
                ) : (
                  <>
                    {computer.name}
                    {computer.renamed && <span className="text-muted" data-tooltip="What it calls itself">{` · ${computer.ownName}`}</span>}
                  </>
                )
              }
              status={
                <>
                  {computer.state === 'connected' ? <ConnectedNow /> : computerLine(computer)}
                  {` · paired ${remoteAge(computer.pairedAt)}`}
                  {computer.notify !== 'all' && <span data-computer-notify-status>{` · ${NOTIFY_STATUS[computer.notify]}`}</span>}
                </>
              }
              actions={
                <>
                  {computer.state === 'offline' && (
                    <Button size="sm" variant="quiet" onClick={() => void client.call('computers.retry', { id: computer.id })}>
                      Try again
                    </Button>
                  )}
                  <Button size="sm" variant="quiet" icon={<Pencil size={12} aria-hidden />} onClick={() => setRenaming(computer.id)} data-computer-rename>
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={<span aria-hidden className="size-2.5 rounded-full" style={{ background: COMPUTER_COLOR_VAR[computer.color] }} />}
                    aria-expanded={colouring === computer.id}
                    onClick={() => {
                      setNotifying(null);
                      setColouring(colouring === computer.id ? null : computer.id);
                    }}
                    data-computer-colour
                  >
                    Colour
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    iconOnly
                    icon={<NotifyIcon notify={computer.notify} />}
                    aria-label={`Notifications from ${computer.name}`}
                    data-tooltip={`Notifications: ${NOTIFY_LABEL[computer.notify]}`}
                    aria-expanded={notifying === computer.id}
                    onClick={() => {
                      setColouring(null);
                      setNotifying(notifying === computer.id ? null : computer.id);
                    }}
                    data-computer-notify={computer.notify}
                  />
                  <Button size="sm" variant="quiet" onClick={() => useComputers.getState().openPage(computer.id)} data-computer-open>
                    Open
                  </Button>
                  <Button ref={(el) => void removeButtons.current.set(computer.id, el)} size="sm" variant="danger" aria-expanded={removing === computer.id} onClick={() => setRemoving(computer.id)} data-computer-forget>
                    Remove
                  </Button>
                </>
              }
              confirm={
                removing === computer.id ? (
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
                ) : (
                  (colouring === computer.id && <ColourStrip computer={computer} onPick={(color) => update(computer.id, { color })} onClose={() => setColouring(null)} />) ||
                  (notifying === computer.id && <NotifyStrip computer={computer} onPick={(notify) => update(computer.id, { notify })} onClose={() => setNotifying(null)} />)
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

/**
 * A computer's colour, in a strip under its row: what its chips, its rows' badges and the line over its sessions
 * show here. Violet is the default; Esc or Done closes it.
 */
function ColourStrip({ computer, onPick, onClose }: { computer: Computer; onPick(color: ComputerColor): void; onClose(): void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 bg-text/4 px-4 py-2.5"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }}
      data-computer-colours={computer.id}
    >
      <span className="text-ui text-muted">Colour of {computer.name}</span>
      <RadioGroup label={`Colour of ${computer.name}`} className="flex flex-1 items-center gap-1">
        {COMPUTER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={computer.color === color}
            aria-label={COMPUTER_COLOR_NAME[color]}
            data-tooltip={COMPUTER_COLOR_NAME[color]}
            tabIndex={computer.color === color ? 0 : -1}
            autoFocus={computer.color === color}
            onClick={() => computer.color !== color && onPick(color)}
            className={`flex size-5 items-center justify-center rounded-full ${computer.color === color ? 'ring-2 ring-accent-ink/70 ring-offset-1 ring-offset-card' : ''}`}
            data-computer-colour-option={color}
          >
            <span aria-hidden className="size-3.5 rounded-full" style={{ background: COMPUTER_COLOR_VAR[color] }} />
          </button>
        ))}
      </RadioGroup>
      <Button size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

const NOTIFY_LABEL: Record<ComputerNotify, string> = { all: 'All', 'needs-you': 'Needs you', off: 'Off' };
const NOTIFY_HINT: Record<ComputerNotify, string> = { all: 'Needs you, finished and failed', 'needs-you': 'Only when a session waits for you', off: 'None. Its sessions still show here.' };
/** In the row's status line, when it isn't all of them. */
const NOTIFY_STATUS: Record<ComputerNotify, string> = { all: '', 'needs-you': 'Notifies only when it needs you', off: 'Notifications off' };

function NotifyIcon({ notify }: { notify: ComputerNotify }) {
  if (notify === 'off') return <BellOff size={14} aria-hidden />;
  if (notify === 'needs-you') return <BellRing size={14} aria-hidden />;
  return <Bell size={14} aria-hidden />;
}

/**
 * Which of a computer's notifications show here, in a strip under its row, like its colour. Its sessions stay in the
 * sidebar whatever you pick. Esc or Done closes it.
 */
function NotifyStrip({ computer, onPick, onClose }: { computer: Computer; onPick(notify: ComputerNotify): void; onClose(): void }) {
  const strip = useRef<HTMLDivElement>(null);
  // Focus starts on the choice it has, as in the colours, so the arrows and Esc work at once.
  useEffect(() => strip.current?.querySelector<HTMLButtonElement>('[role=radio][aria-checked=true]')?.focus(), []);
  return (
    <div
      ref={strip}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-text/4 px-4 py-2.5"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }}
      data-computer-notify-options={computer.id}
    >
      <span className="text-ui text-muted">Notifications from {computer.name}</span>
      <RadioGroup label={`Notifications from ${computer.name}`} className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        {COMPUTER_NOTIFY.map((notify) => (
          <Radio key={notify} checked={computer.notify === notify} onSelect={() => computer.notify !== notify && onPick(notify)} dataAttrs={{ 'data-computer-notify-option': notify }}>
            <span className="text-ui">{NOTIFY_LABEL[notify]}</span>
          </Radio>
        ))}
      </RadioGroup>
      <span className="text-meta text-muted">{NOTIFY_HINT[computer.notify]}</span>
      <Button size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
