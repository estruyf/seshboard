import { Check, ChevronRight, Copy, ExternalLink, Globe, Laptop, Pencil, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RemoteSettings as Settings, RemoteStatus, RemoteTunnel } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ComputersSettings } from '../computers/ComputersSettings.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { LinkDialog, PairDialog } from './PairDialog.tsx';
import { ConfirmStrip, ConnectedNow, dangerQuiet, ListRow, RenameField } from './RemoteRows.tsx';
import { addressCanChange, connectionLine, remoteStatusView, type StatusAction, type StatusTone, type StatusView } from './remoteStatusView.ts';
import { remoteAge, TUNNELS } from './remoteText.ts';

const field = 'h-7 min-w-0 flex-1 rounded-md border border-edge bg-card px-2 font-mono text-ui text-text placeholder:text-faint';
const SECURITY =
  "Anyone can reach the address, but only paired devices get in. Every connection is checked with the device's key and encrypted from the device to this computer.";
/** Advanced is open or closed per window, as the right panel is. */
const ADVANCED_KEY = 'switchboard.remote.advanced';

type Client = NonNullable<ReturnType<typeof useClient>>;
function useClient() {
  const connection = useEngineConnection();
  return connection.status === 'connected' ? connection.client : null;
}

/**
 * Settings › Remote, laid out for daily use (docs/remote-access.md): the switch, a status card that says whether
 * Remote works and how to fix it when it doesn't, the paired devices, the connection (folded once set), Advanced (the
 * port and how it is secured), then Other computers. With Remote off and nothing paired, three setup steps instead.
 */
export function RemoteSettings() {
  const client = useClient();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'pair' | 'link' | null>(null);
  const [connectionOpen, setConnectionOpen] = useState<boolean | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(() => readAdvanced());
  const portInput = useRef<HTMLInputElement>(null);
  const [focusPort, setFocusPort] = useState(0);
  const titleId = useId();

  useEffect(() => {
    if (!client) return;
    let current = true;
    void client.call('remote.status', {}).then(
      (next) => current && setStatus(next),
      (e: Error) => current && setError(e.message),
    );
    const off = client.on('remote.changed', setStatus);
    return () => {
      current = false;
      off();
    };
  }, [client]);

  useEffect(() => {
    if (!focusPort) return;
    portInput.current?.focus();
    portInput.current?.select();
  }, [focusPort]);

  const configure = (change: Partial<Settings>) => {
    if (!client) return;
    setError(null);
    void client.call('remote.configure', change).then(setStatus, (e: Error) => setError(e.message));
  };
  const toggleAdvanced = (open: boolean) => {
    setAdvancedOpen(open);
    writeAdvanced(open);
  };

  if (!status) return error ? <Notice tone="error">{error}</Notice> : <p className="py-6 text-ui text-muted">Checking…</p>;
  if (!status.available) return <Notice className="my-6">Remote isn't available in this build of Switchboard.</Notice>;

  const { settings } = status;
  // Open by default while Remote is off (you are setting it up), folded once it runs.
  const connectionShown = connectionOpen ?? !settings.enabled;
  const firstSetup = !settings.enabled && status.devices.length === 0;

  const act = (action: StatusAction) => {
    switch (action.kind) {
      case 'pair':
        return setDialog('pair');
      case 'reconnect':
        return setDialog('link');
      case 'install':
        // The main process opens http(s) links from window.open in the browser.
        return void window.open(action.url, '_blank');
      case 'use-cloudflare':
        return configure({ tunnel: 'cloudflare' });
      case 'use-port':
        return configure({ port: action.port });
      case 'change-port':
        toggleAdvanced(true);
        return setFocusPort((n) => n + 1);
      case 'change-connection':
        return setConnectionOpen(true);
      case 'retry':
        return configure({});
      case 'details':
        return;
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 py-6" data-remote-settings>
      <section aria-labelledby={titleId} className="grid gap-5">
        <div className="grid gap-0.5">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="text-body font-semibold">
              Remote
            </h2>
            <Switch checked={settings.enabled} label="Allow access from my phone" onChange={(enabled) => configure({ enabled })} dataAttrs={{ 'data-remote-enabled': true }} />
          </div>
          <p className="text-ui text-muted">Follow your sessions from your phone or another browser, answer Claude and send prompts. Only devices you pair get in.</p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {firstSetup ? (
          <>
            <SetupSteps status={status} configure={configure} />
            <SecurityNote />
          </>
        ) : (
          <>
            {settings.enabled ? (
              <StatusCard view={remoteStatusView(status)!} onAction={act} />
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-card px-4 py-3" data-remote-off-card>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-faint" />
                <p className="min-w-0 flex-1 text-ui text-muted">Remote is off. Paired devices can't connect.</p>
                <Button size="sm" onClick={() => configure({ enabled: true })} data-remote-turn-on>
                  Turn on
                </Button>
              </div>
            )}
            <Devices status={status} client={client} onPair={() => setDialog('pair')} onError={setError} />
            <Connection status={status} open={connectionShown} onOpen={setConnectionOpen} configure={configure} />
            <Advanced status={status} open={advancedOpen} onToggle={toggleAdvanced} portInput={portInput} configure={configure} onError={setError} onReconnect={() => setDialog('link')} />
          </>
        )}
      </section>

      <section className="grid gap-4 border-t border-border pt-6" aria-labelledby={`${titleId}-computers`} data-remote-computers>
        <div className="grid gap-0.5">
          <h3 id={`${titleId}-computers`} className="text-body font-semibold">
            Other computers
          </h3>
          <p className="text-ui text-muted">Follow Switchboard on another computer from here. Claude keeps running there.</p>
        </div>
        <ComputersSettings />
      </section>

      {dialog === 'pair' && client && <PairDialog client={client} status={status} onClose={() => setDialog(null)} />}
      {dialog === 'link' && client && <LinkDialog client={client} onClose={() => setDialog(null)} />}
    </div>
  );
}

function readAdvanced(): boolean {
  try {
    return sessionStorage.getItem(ADVANCED_KEY) === 'open';
  } catch {
    return false;
  }
}

function writeAdvanced(open: boolean): void {
  try {
    sessionStorage.setItem(ADVANCED_KEY, open ? 'open' : 'closed');
  } catch {
    // Without storage it is only forgotten on reload.
  }
}

// ---------------------------------------------------------------------------------------------------------
// The status card

/** Each tone: the dot, a 6% tint and a 30% border. The accent's ink colour reads in light mode too. */
const TONE: Record<StatusTone, { dot: string; box: string }> = {
  ok: { dot: 'bg-ok', box: 'border-ok/30 bg-ok/6' },
  accent: { dot: 'bg-accent-ink animate-pulse', box: 'border-accent-ink/30 bg-accent/6' },
  error: { dot: 'bg-error', box: 'border-error/30 bg-error/6' },
  caution: { dot: 'bg-caution', box: 'border-caution/30 bg-caution/6' },
};

function StatusCard({ view, onAction }: { view: StatusView; onAction(action: StatusAction): void }) {
  const [details, setDetails] = useState(false);
  const tone = TONE[view.tone];
  return (
    <div role="status" className={`grid gap-3 rounded-xl border px-4 py-3.5 ${tone.box}`} data-remote-status={view.tone} data-remote-status-title={view.title}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-ui font-semibold">{view.title}</p>
          <p className="text-ui text-muted">{view.detail}</p>
          {view.address && <AddressField address={view.address} />}
        </div>
        {view.actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {view.actions.map(({ action, label, primary }) =>
              action.kind === 'details' ? (
                <Button key={label} size="sm" variant="quiet" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
                  {details ? 'Hide details' : label}
                </Button>
              ) : (
                <Button key={label} size="sm" variant={primary ? 'primary' : 'secondary'} icon={action.kind === 'install' ? <ExternalLink size={12} aria-hidden /> : undefined} onClick={() => onAction(action)} data-remote-action={action.kind}>
                  {label}
                </Button>
              ),
            )}
          </div>
        )}
      </div>
      {details && view.details && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg p-2.5 font-mono text-meta">{view.details}</pre>}
    </div>
  );
}

function AddressField({ address }: { address: string }) {
  const [copied, flash] = useFlash(1500);
  return (
    <div className="mt-1.5 flex max-w-xl items-center gap-1 rounded-md border border-border bg-bg py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-meta" data-remote-address>
        {address}
      </code>
      <Button size="sm" variant="quiet" icon={copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} onClick={() => void navigator.clipboard.writeText(address).then(() => flash('Copied'), () => {})}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Paired devices

const DEVICE_ICON = { phone: Smartphone, browser: Laptop, computer: Laptop } as const;

function Devices({ status, client, onPair, onError }: { status: RemoteStatus; client: Client | null; onPair(): void; onError(message: string): void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const revokeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const connected = new Set(status.connections.map((c) => c.deviceId));
  const { devices } = status;

  return (
    <div className="grid gap-2" data-remote-devices>
      <p className="flex items-center gap-2 text-ui font-medium">
        Paired devices
        {devices.length > 0 && <span className="rounded-full bg-border/70 px-1.5 text-meta tabular-nums text-muted">{devices.length}</span>}
      </p>
      {devices.length === 0 ? (
        <p className="text-ui text-muted" data-remote-no-devices>
          No devices yet.{' '}
          <button type="button" className="text-link hover:underline" onClick={onPair} disabled={!status.settings.enabled || !status.address}>
            Pair a device
          </button>{' '}
          to follow your sessions from your phone.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {devices.map((device) => {
            const Icon = DEVICE_ICON[device.kind];
            const returnTo = { current: revokeButtons.current.get(device.id) ?? null };
            return (
              <ListRow
                key={device.id}
                attrs={{ 'data-remote-device': device.id }}
                icon={<Icon size={16} aria-hidden />}
                name={
                  renaming === device.id ? (
                    <RenameField
                      name={device.name}
                      label={`Name of ${device.name}`}
                      onCancel={() => setRenaming(null)}
                      onSave={(name) => {
                        setRenaming(null);
                        void client?.call('remote.rename', { deviceId: device.id, name }).catch((e: Error) => onError(e.message));
                      }}
                    />
                  ) : (
                    device.name
                  )
                }
                status={
                  <>
                    {connected.has(device.id) ? <ConnectedNow /> : device.lastSeenAt ? `last connected ${remoteAge(device.lastSeenAt)}` : 'not connected yet'}
                    {` · paired ${remoteAge(device.createdAt)}`}
                  </>
                }
                actions={
                  <>
                    <Button size="sm" variant="quiet" icon={<Pencil size={12} aria-hidden />} onClick={() => setRenaming(device.id)} data-remote-rename>
                      Rename
                    </Button>
                    <Button
                      ref={(el) => void revokeButtons.current.set(device.id, el)}
                      size="sm"
                      variant="quiet"
                      className={dangerQuiet}
                      aria-expanded={revoking === device.id}
                      onClick={() => setRevoking(device.id)}
                      data-remote-revoke
                    >
                      Revoke
                    </Button>
                  </>
                }
                confirm={
                  revoking === device.id && (
                    <ConfirmStrip
                      question={`Revoke ${device.name}? It disconnects now and has to pair again.`}
                      action="Revoke"
                      returnTo={returnTo}
                      onCancel={() => setRevoking(null)}
                      onConfirm={() => {
                        setRevoking(null);
                        void client?.call('remote.revoke', { deviceId: device.id }).catch((e: Error) => onError(e.message));
                      }}
                    />
                  )
                }
              />
            );
          })}
        </ul>
      )}
      {devices.length > 0 && <p className="text-meta text-muted">Revoke disconnects a device at once. Devices that don't connect for 30 days are removed.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Connection

function Connection({ status, open, onOpen, configure }: { status: RemoteStatus; open: boolean; onOpen(open: boolean): void; configure(change: Partial<Settings>): void }) {
  const line = connectionLine(status);
  const panelId = useId();
  return (
    <div className="grid gap-2" data-remote-connection>
      <p className="text-ui font-medium">Connection</p>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Globe size={16} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui">{line.name}</span>
            <span className="block truncate font-mono text-meta text-muted">{line.address}</span>
          </span>
          {!open && (
            <Button size="sm" aria-expanded={false} aria-controls={panelId} onClick={() => onOpen(true)} data-remote-change-connection>
              Change…
            </Button>
          )}
        </div>
        {open && (
          <div id={panelId} className="border-t border-border px-4 py-3.5">
            <TunnelPicker
              status={status}
              onCancel={status.settings.enabled ? () => onOpen(false) : null}
              onSave={(change) => {
                configure({ ...change, customUrl: change.customUrl && cleanUrl(change.customUrl), ngrokDomain: change.ngrokDomain && cleanDomain(change.ngrokDomain) });
                if (status.settings.enabled) onOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

type TunnelDraft = Pick<Settings, 'tunnel' | 'customUrl' | 'ngrokDomain'>;

const cleanUrl = (value: string) => value.trim().replace(/\/$/, '') || null;
const cleanDomain = (value: string) => value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') || null;

/** The tunnel choices, as a draft: nothing changes until Save and restart. */
function TunnelPicker({ status, onSave, onCancel }: { status: RemoteStatus; onSave(change: TunnelDraft): void; onCancel: (() => void) | null }) {
  const { settings } = status;
  const [draft, setDraft] = useState<TunnelDraft>({ tunnel: settings.tunnel, customUrl: settings.customUrl, ngrokDomain: settings.ngrokDomain });
  const changed = draft.tunnel !== settings.tunnel || draft.customUrl !== settings.customUrl || draft.ngrokDomain !== settings.ngrokDomain;
  return (
    <div className="grid gap-3.5" data-remote-tunnel>
      <RadioGroup label="Reach this computer through" className="grid gap-3">
        {TUNNELS.map((tunnel) => {
          const missing = tunnel.id !== 'custom' && !status.tools[tunnel.id];
          return (
            <Radio key={tunnel.id} checked={draft.tunnel === tunnel.id} onSelect={() => setDraft({ ...draft, tunnel: tunnel.id })} dataAttrs={{ 'data-remote-tunnel-option': tunnel.id }}>
              <span className="flex flex-wrap items-center gap-2 text-ui">
                {tunnel.label}
                {tunnel.id === 'cloudflare' && <Tag tone="ok">Easiest</Tag>}
                {missing && <Tag tone="caution">Not installed</Tag>}
                {missing && tunnel.install && (
                  <a href={tunnel.install} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-meta text-link hover:underline" onClick={(event) => event.stopPropagation()}>
                    Install <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </span>
              <span className="block text-meta text-muted">{tunnel.detail}</span>
            </Radio>
          );
        })}
      </RadioGroup>
      <TunnelField draft={draft} onChange={setDraft} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!changed && !!onCancel} onClick={() => onSave(draft)} data-remote-save-connection>
          {status.settings.enabled ? 'Save and restart' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

/** The extra field My own address and ngrok need, under the list. */
function TunnelField({ draft, onChange }: { draft: TunnelDraft; onChange(draft: TunnelDraft): void }) {
  if (draft.tunnel === 'custom') {
    return (
      <label className="flex items-center gap-2 pl-5.5" data-remote-custom-url>
        <span className="shrink-0 text-ui text-muted">Address</span>
        <input value={draft.customUrl ?? ''} placeholder="https://remote.example.com" spellCheck={false} onChange={(event) => onChange({ ...draft, customUrl: event.target.value })} onBlur={(event) => onChange({ ...draft, customUrl: cleanUrl(event.target.value) })} className={field} />
      </label>
    );
  }
  if (draft.tunnel === 'ngrok') {
    return (
      <label className="flex items-center gap-2 pl-5.5" data-remote-ngrok-domain>
        <span className="shrink-0 text-ui text-muted">ngrok domain</span>
        <input value={draft.ngrokDomain ?? ''} placeholder="name.ngrok-free.app" spellCheck={false} onChange={(event) => onChange({ ...draft, ngrokDomain: event.target.value })} onBlur={(event) => onChange({ ...draft, ngrokDomain: cleanDomain(event.target.value) })} className={field} />
      </label>
    );
  }
  return null;
}

function Tag({ tone, children }: { tone: 'ok' | 'caution'; children: ReactNode }) {
  return <span className={`rounded-full border px-1.5 text-meta leading-4 ${tone === 'ok' ? 'border-ok/30 bg-ok/6 text-ok' : 'border-caution/30 bg-caution/8 text-caution'}`}>{children}</span>;
}

// ---------------------------------------------------------------------------------------------------------
// Advanced

function Advanced({
  status,
  open,
  onToggle,
  portInput,
  configure,
  onError,
  onReconnect,
}: {
  status: RemoteStatus;
  open: boolean;
  onToggle(open: boolean): void;
  portInput: React.RefObject<HTMLInputElement | null>;
  configure(change: Partial<Settings>): void;
  onError(message: string): void;
  onReconnect(): void;
}) {
  const panelId = useId();
  const { settings } = status;
  const [port, setPort] = useState(String(settings.port));
  useEffect(() => setPort(String(settings.port)), [settings.port]);
  const savePort = () => {
    const next = Number(port);
    if (next === settings.port) return;
    if (!Number.isInteger(next) || next < 1024 || next > 65535) return onError('Use a port between 1024 and 65535.');
    configure({ port: next });
  };
  const reconnect = addressCanChange(settings) && status.devices.length > 0 && settings.enabled && !!status.address;
  return (
    <div className="grid gap-2" data-remote-advanced>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(!open)} className="flex items-center gap-1.5 justify-self-start rounded text-ui font-medium hover:text-text" data-remote-advanced-toggle>
        <ChevronRight size={14} aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        Advanced
        <span className="font-normal text-muted">port, security</span>
      </button>
      {open && (
        <div id={panelId} className="grid gap-4 rounded-lg border border-border bg-card px-4 py-3.5">
          <div className="grid gap-1.5" data-remote-port>
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-ui">Port</span>
              <input ref={portInput} value={port} inputMode="numeric" spellCheck={false} onChange={(event) => setPort(event.target.value)} onBlur={savePort} onKeyDown={(event) => event.key === 'Enter' && savePort()} className={`${field} max-w-24 flex-none`} data-remote-port-input />
            </label>
            <p className="text-meta text-muted">
              Remote listens on <code className="font-mono text-text">127.0.0.1:{settings.port}</code>. Point your tunnel there. Changing it restarts Remote.
            </p>
          </div>
          <SecurityNote />
          {reconnect && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3.5">
              <p className="min-w-0 flex-1 text-meta text-muted">A quick tunnel gets a new address each time it starts. Paired devices pick it up from a link.</p>
              <Button size="sm" onClick={onReconnect} data-remote-link>
                Reconnect a paired device…
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecurityNote() {
  return (
    <p className="flex items-start gap-2 text-meta text-muted" data-remote-security>
      <ShieldCheck size={14} aria-hidden className="mt-px shrink-0 text-ok" />
      <span>{SECURITY}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------
// The first setup

function SetupSteps({ status, configure }: { status: RemoteStatus; configure(change: Partial<Settings>): void }) {
  const { settings } = status;
  const [draft, setDraft] = useState<TunnelDraft>({ tunnel: settings.tunnel, customUrl: settings.customUrl, ngrokDomain: settings.ngrokDomain });
  const choose = (next: TunnelDraft) => {
    setDraft(next);
    // Remote is off: saving the choice starts nothing.
    configure(next);
  };
  return (
    <div className="grid gap-4 rounded-xl border border-edge bg-card px-5 py-4" data-remote-setup>
      <p className="text-ui font-semibold">Set up in three steps</p>
      <ol className="grid gap-4">
        <Step n={1} title="Choose how your phone reaches this computer." detail="You can change it later.">
          <RadioGroup label="Reach this computer through" className="mt-2 grid gap-1.5">
            {TUNNELS.map((tunnel) => (
              <Radio key={tunnel.id} checked={draft.tunnel === tunnel.id} onSelect={() => choose({ ...draft, tunnel: tunnel.id })} dataAttrs={{ 'data-remote-tunnel-option': tunnel.id }}>
                <span className="text-ui">{tunnel.label}</span>
                <span className="text-meta text-muted">
                  {' '}
                  · {tunnel.hint}
                  {tunnel.id !== 'custom' && !status.tools[tunnel.id as Exclude<RemoteTunnel, 'custom'>] && <span className="text-caution"> · not installed</span>}
                </span>
              </Radio>
            ))}
          </RadioGroup>
          <div className="mt-2">
            <TunnelField draft={draft} onChange={setDraft} />
          </div>
          {(draft.customUrl !== settings.customUrl || draft.ngrokDomain !== settings.ngrokDomain) && (
            <Button size="sm" className="mt-2" onClick={() => configure({ ...draft, customUrl: draft.customUrl && cleanUrl(draft.customUrl), ngrokDomain: draft.ngrokDomain && cleanDomain(draft.ngrokDomain) })}>
              Save
            </Button>
          )}
        </Step>
        <Step n={2} title="Turn on Remote." detail="Switchboard starts the tunnel and shows the address.">
          <Button variant="primary" className="mt-2" onClick={() => configure({ ...draft, enabled: true })} data-remote-turn-on>
            Turn on Remote
          </Button>
        </Step>
        <Step n={3} title="Pair a device." detail="Scan a QR code with your phone, or open the link in another browser." />
      </ol>
    </div>
  );
}

function Step({ n, title, detail, children }: { n: number; title: string; detail: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3" data-remote-step={n}>
      <span aria-hidden className="flex size-5.5 shrink-0 items-center justify-center rounded-full border border-edge text-meta font-semibold tabular-nums text-muted">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium">{title}</p>
        <p className="text-meta text-muted">{detail}</p>
        {children}
      </div>
    </li>
  );
}
