import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Bell, BellDot, BellOff, BellRing, ChevronDown, Link2, LoaderCircle, Monitor, MoreHorizontal, Pencil, RefreshCw, RotateCw } from 'lucide-react';
import { COMPUTER_COLORS, COMPUTER_NOTIFY, type Computer, type ComputerColor, type ComputerNotify, type Contract, type RemoteSessions, type RpcClient } from '@seshboard/protocol/client';
import { useComputers } from '../../state/computersStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useUpdates } from '../../state/updatesStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { ConfirmStrip, RenameField } from '../remote/RemoteRows.tsx';
import { remoteAge } from '../remote/remoteText.ts';
import { Button } from '../ui/Button.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { callComputer } from './callComputer.ts';
import { COMPUTER_COLOR_NAME, COMPUTER_COLOR_VAR, computerTint } from './computerColor.ts';
import { computerLine } from './computerSessions.ts';
import { rowUpdate, workingThere, type HereUpdate, type RowAsk } from './computerUpdate.ts';

const NOTIFY_LABEL: Record<ComputerNotify, string> = { all: 'All', 'started-here': 'Only mine', 'needs-you': 'Needs you', off: 'None' };
const notifyHint = (notify: ComputerNotify, name: string): string =>
  ({ all: 'Needs you, finished and failed', 'started-here': 'For sessions you started or acted on', 'needs-you': 'Only when a session waits', off: `Nothing from ${name}` })[notify];

function NotifyIcon({ notify }: { notify: ComputerNotify }) {
  if (notify === 'off') return <BellOff size={13} aria-hidden />;
  if (notify === 'needs-you') return <BellRing size={13} aria-hidden />;
  if (notify === 'started-here') return <BellDot size={13} aria-hidden />;
  return <Bell size={13} aria-hidden />;
}

const TONE = { link: 'text-link', caution: 'text-caution', ok: 'text-ok', muted: 'text-muted' } as const;

/**
 * A paired computer in Settings › Remote, Other computers (docs/remote-access.md): its icon in its colour, its name,
 * its state and version with what its updater says, then Update when it is behind, the notifications choice, Open
 * and ⋯ (Rename, Colour, Check for updates, Update to …, Copy its address, Reconnect, Remove). Updating is always
 * started here by hand; with sessions working there, a panel under the row asks first and offers to wait for idle.
 */
export function ComputerRow({
  computer,
  client,
  list,
  notifyOpen,
  onNotifyShown,
  onChange,
  onError,
}: {
  computer: Computer;
  client: RpcClient<Contract>;
  /** Its last session list, for who works there. */
  list: RemoteSessions | null;
  /** Its chip's menu asked for its notifications: the choice opens. */
  notifyOpen: boolean;
  onNotifyShown(): void;
  onChange(changes: { name?: string; color?: ComputerColor; notify?: ComputerNotify }): void;
  onError(message: string): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [colouring, setColouring] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const more = useMenu();
  const notify = useMenu();
  const moreButton = useRef<HTMLButtonElement>(null);
  const notifyButton = useRef<HTMLButtonElement>(null);
  const ask = useComputers((s) => s.updateAsks.get(computer.id) ?? null);
  const updatedTo = useComputers((s) => s.updatedTo.get(computer.id) ?? null);
  const hereState = useUpdates((s) => s.state);
  const here: HereUpdate | null = hereState ? { version: hereState.currentVersion, availableVersion: hereState.availableVersion, channel: hereState.channel } : null;
  const update = rowUpdate({ computer, here, ask, updatedTo, now: Date.now() });
  const name = computer.name;
  /** Who works there, for the panel: from its last list, asked for when there is none yet. */
  const [working, setWorking] = useState<string | null>(null);

  // Notifications in its chip's menu: the choice opens here, in view.
  useEffect(() => {
    if (!notifyOpen || !notifyButton.current) return;
    notifyButton.current.scrollIntoView({ block: 'center' });
    notify.openBelow(notifyButton.current);
    onNotifyShown();
  }, [notifyOpen]);

  const setAsk = (next: RowAsk | null) => useComputers.getState().setUpdateAsk(computer.id, next);
  const send = async (run: () => Promise<unknown>, next: RowAsk) => {
    if (sending) return;
    setSending(true);
    setAsk(next);
    try {
      await run();
    } catch (error) {
      setAsk({ ...next, error: error instanceof Error ? error.message.replace(/\.$/, '') : 'That didn’t reach it' });
    } finally {
      setSending(false);
    }
  };
  const askOf = (kind: 'check' | 'install'): RowAsk => ({ kind, from: computer.version ?? '', version: kind === 'install' ? update.offer : null, at: Date.now(), error: null });
  const check = () => void send(() => callComputer(client, computer.id, 'app.update.check', {}), askOf('check'));
  const install = (when: 'now' | 'idle') => {
    setAsking(false);
    void send(() => callComputer(client, computer.id, 'app.update.install', { when }), askOf('install'));
  };
  /** Update: at once when nothing works there, else the panel asks first. */
  const startUpdate = async () => {
    const sessions = list?.sessions ?? (await callComputer(client, computer.id, 'sessions.list', {}).catch(() => null))?.sessions;
    // Not known: ask rather than stop someone's work.
    const line = sessions ? workingThere(computer, sessions) : `Seshboard on ${name} may have sessions working.`;
    setWorking(line);
    if (line) setAsking(true);
    else install('now');
  };
  const cancel = async () => {
    try {
      await callComputer(client, computer.id, 'app.update.cancel', {});
      setAsk(null);
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const onButton = () => {
    const kind = update.button?.kind;
    if (kind === 'cancel') return void cancel();
    if (kind === 'update-here') return useSessions.getState().openSettings('about');
    if (kind === 'retry' && ask?.kind === 'check') return check();
    void startUpdate();
  };

  const connected = computer.state === 'connected';
  const offline = !connected ? 'Connect to it first.' : null;
  const moreEntries: MenuEntry[] = [
    { label: 'Rename…', icon: <Pencil size={13} aria-hidden />, onSelect: () => setRenaming(true), data: { 'data-computer-rename': true } },
    {
      label: 'Colour',
      icon: <span aria-hidden className="block size-2.5 rounded-full" style={{ background: COMPUTER_COLOR_VAR[computer.color] }} />,
      end: (
        <span aria-hidden className="flex items-center gap-1">
          {COMPUTER_COLORS.map((color) => (
            <span key={color} className="size-2 rounded-full" style={{ background: COMPUTER_COLOR_VAR[color] }} />
          ))}
        </span>
      ),
      onSelect: () => setColouring(true),
      data: { 'data-computer-colour': true },
    },
    'separator',
    { label: 'Check for updates', icon: <RefreshCw size={13} aria-hidden />, ...((offline ?? update.note) ? { disabledReason: offline ?? update.note! } : {}), onSelect: check, data: { 'data-computer-check': true } },
    ...(update.offer ? [{ label: `Update to ${update.offer}…`, icon: <ArrowUpCircle size={13} aria-hidden />, onSelect: () => void startUpdate(), data: { 'data-computer-update-to': update.offer } }] : []),
    ...(update.note ? [{ note: update.note, tone: 'faint' as const }] : []),
    'separator',
    {
      label: 'Copy its address',
      icon: <Link2 size={13} aria-hidden />,
      onSelect: () =>
        void navigator.clipboard.writeText(computer.address).then(
          () => toast('Address copied'),
          () => onError('Couldn’t copy the address.'),
        ),
      data: { 'data-computer-copy-address': true },
    },
    { label: 'Reconnect', icon: <RotateCw size={13} aria-hidden />, ...(computer.state === 'connected' || computer.state === 'connecting' ? { disabledReason: computer.state === 'connected' ? 'It’s connected now.' : 'It’s connecting now.' } : {}), onSelect: () => void client.call('computers.retry', { id: computer.id }), data: { 'data-computer-reconnect': true } },
    'separator',
    { label: 'Remove…', danger: true, onSelect: () => setRemoving(true), data: { 'data-computer-forget': true } },
  ];

  const paired = `paired ${remoteAge(computer.pairedAt)}`;
  const dot = update.restarting ? 'bg-faint' : connected ? 'bg-ok' : null;
  return (
    <li className="grid grid-cols-1" data-computer={computer.id} data-computer-state={computer.state}>
      <div className="flex min-h-12 items-center gap-3 px-4 py-2">
        <span className="flex shrink-0 text-remote" style={computerTint(computer.color)} data-computer-color={computer.color}>
          <Monitor size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui">
            {renaming ? (
              <RenameField
                name={name}
                label={`Name of ${name}`}
                clearable
                placeholder={computer.ownName}
                onCancel={() => setRenaming(false)}
                onSave={(next) => {
                  setRenaming(false);
                  onChange({ name: next });
                }}
              />
            ) : (
              <>
                <span className="font-medium">{name}</span>
                {computer.renamed && <span className="text-muted" data-tooltip="What it calls itself">{` · ${computer.ownName}`}</span>}
              </>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-tooltip={update.line && update.state !== 'updated' ? `Paired ${remoteAge(computer.pairedAt)}` : undefined} data-computer-update-state={update.state}>
            {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
            <span className="min-w-0 truncate">
              {!update.restarting && (
                <>
                  <span className={connected ? 'text-ok' : undefined}>{connected ? 'Connected' : computerLine(computer)}</span>
                  {` · ${computer.version ?? '–'} · `}
                </>
              )}
              {/* What the updater says is announced as it changes, the countdown of an offline computer isn't. */}
              <span aria-live="polite">
                {update.state === 'updated' && `${paired} · `}
                {update.line ? <span className={update.restarting ? undefined : TONE[update.tone]}>{update.line}</span> : paired}
                {update.aside && <span>{` · ${update.aside}`}</span>}
              </span>
            </span>
          </span>
          {update.detail && <span className="block text-meta text-muted">{update.detail}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {update.button && !asking && (
            <Button
              size="sm"
              variant={update.button.kind === 'cancel' ? 'quiet' : update.button.kind === 'retry' ? 'secondary' : 'tint'}
              icon={sending ? <LoaderCircle size={12} className="animate-spin" aria-hidden /> : update.button.kind === 'update' ? <ArrowUpCircle size={13} aria-hidden /> : undefined}
              aria-label={update.button.aria}
              aria-busy={sending || undefined}
              disabled={sending}
              onClick={onButton}
              data-computer-update={update.button.kind}
            >
              {update.button.label}
            </Button>
          )}
          <Button
            ref={notifyButton}
            size="sm"
            variant="quiet"
            icon={<NotifyIcon notify={computer.notify} />}
            aria-haspopup="menu"
            aria-expanded={!!notify.at}
            aria-label={`Notifications from ${name}: ${NOTIFY_LABEL[computer.notify]}`}
            onClick={(event) => (notify.at ? notify.close() : notify.openBelow(event.currentTarget))}
            data-computer-notify={computer.notify}
          >
            {NOTIFY_LABEL[computer.notify]}
            <ChevronDown size={11} aria-hidden className="text-faint" />
          </Button>
          <Button size="sm" variant="quiet" onClick={() => useComputers.getState().openPage(computer.id)} data-computer-open>
            Open
          </Button>
          <Button
            ref={moreButton}
            size="sm"
            variant="quiet"
            iconOnly
            icon={<MoreHorizontal size={14} aria-hidden />}
            aria-label={`More for ${name}`}
            aria-haspopup="menu"
            aria-expanded={!!more.at}
            onClick={(event) => (more.at ? more.close() : more.openBelow(event.currentTarget))}
            data-computer-more
          />
        </span>
      </div>
      {asking && working && <UpdatePanel name={name} working={working} onIdle={() => install('idle')} onNow={() => install('now')} onCancel={() => setAsking(false)} />}
      {removing && (
        <ConfirmStrip
          question={`Remove ${name}? Its sessions leave this computer. To pair again, paste a new link.`}
          action="Remove"
          returnTo={moreButton}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void client.call('computers.forget', { id: computer.id }).catch((e: Error) => onError(e.message));
          }}
        />
      )}
      {colouring && (
        <ColourStrip
          computer={computer}
          onPick={(color) => onChange({ color })}
          onClose={() => {
            setColouring(false);
            moreButton.current?.focus();
          }}
        />
      )}
      {more.at && <Menu x={more.at.x} y={more.at.y} width={240} label={`More for ${name}`} anchor={moreButton} entries={moreEntries} onClose={more.close} />}
      {notify.at && (
        <Menu
          x={notify.at.x}
          y={notify.at.y}
          width={260}
          label={`Notifications from ${name}`}
          anchor={notifyButton}
          onClose={notify.close}
          entries={[
            ...COMPUTER_NOTIFY.map((value) => ({
              label: NOTIFY_LABEL[value],
              detail: notifyHint(value, name),
              checked: computer.notify === value,
              onSelect: () => computer.notify !== value && onChange({ notify: value }),
              data: { 'data-computer-notify-option': value },
            })),
            // Which sessions show is a filter where you look (ComputersStrip), not a setting: say where it went.
            { note: `Which sessions show in the sidebar is a filter on ${name}’s chip there.`, tone: 'faint' as const },
          ]}
        />
      )}
    </li>
  );
}

/**
 * Update with sessions working there: who works, what the restart does, and Update when it's idle (the default, which
 * takes focus), Update now or Cancel. Esc cancels.
 */
function UpdatePanel({ name, working, onIdle, onNow, onCancel }: { name: string; working: string; onIdle(): void; onNow(): void; onCancel(): void }) {
  const idle = useRef<HTMLButtonElement>(null);
  useEffect(() => idle.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label={`Update ${name}`}
      className="mx-4 mb-3 grid gap-1.5 rounded-lg bg-text/6 px-3 py-2.5"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        onCancel();
      }}
      data-computer-update-panel
    >
      <p className="text-ui text-text">{working}</p>
      <p className="text-ui text-muted">Updating restarts Seshboard there for everyone on it, and stops what those sessions are doing. Continue them once it’s back.</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button ref={idle} size="sm" variant="tint" onClick={onIdle} data-computer-update-idle>
          Update when it’s idle
        </Button>
        <Button size="sm" onClick={onNow} data-computer-update-now>
          Update now
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel} data-computer-update-cancel>
          Cancel
        </Button>
      </div>
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
