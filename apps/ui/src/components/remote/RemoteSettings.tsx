import { ExternalLink, QrCode, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RemoteSettings as Settings, RemoteStatus, RemoteTunnel } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';
import { Toggle } from '../ui/Toggle.tsx';
import { PairDialog, LinkDialog } from './PairDialog.tsx';
import { remoteAge, tunnelLine, TUNNELS } from './remoteText.ts';

const field = 'h-7 min-w-0 flex-1 rounded-md border border-edge bg-card px-2 font-mono text-ui text-text placeholder:text-faint';

/**
 * Settings › Remote: a paired phone follows and steers sessions through a tunnel (docs/remote-access.md). The switch,
 * the tunnel, pairing (the QR code and Allow), and the paired phones with Revoke.
 */
export function RemoteSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'pair' | 'link' | null>(null);

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

  const configure = (change: Partial<Settings>) => {
    if (!client) return;
    setError(null);
    void client.call('remote.configure', change).then(setStatus, (e: Error) => setError(e.message));
  };

  if (!status) return error ? <Notice tone="error">{error}</Notice> : <p className="text-ui text-muted">Checking…</p>;
  if (!status.available) return <Notice>Remote isn't available in this build of Switchboard.</Notice>;

  const { settings } = status;
  const running = status.tunnel.state === 'running' && status.address !== null;

  return (
    <div className="grid gap-5" data-remote-settings>
      <Toggle
        label="Allow access from my phone"
        detail="Follow your sessions, answer Claude and send prompts from your phone's browser. Only phones you pair here can connect."
        checked={settings.enabled}
        attr="data-remote-enabled"
        onChange={(enabled) => configure({ enabled })}
      />

      <div className="grid gap-2" data-remote-tunnel>
        <p className="text-ui font-medium">Reach this computer through</p>
        <RadioGroup label="Reach this computer through" className="grid gap-2.5">
          {TUNNELS.map((tunnel) => (
            <Radio key={tunnel.id} checked={settings.tunnel === tunnel.id} onSelect={() => configure({ tunnel: tunnel.id })} dataAttrs={{ 'data-remote-tunnel-option': tunnel.id }}>
              <span className="block text-ui">{tunnel.label}</span>
              <span className="block text-meta text-muted">
                {tunnel.detail}
                {tunnel.id !== 'custom' && !status.tools[tunnel.id] && <span className="text-caution"> Not installed.</span>}
              </span>
            </Radio>
          ))}
        </RadioGroup>
        {settings.tunnel === 'ngrok' && (
          <TextSetting
            label="ngrok domain"
            placeholder="name.ngrok-free.app"
            value={settings.ngrokDomain ?? ''}
            attr="data-remote-ngrok-domain"
            onSave={(value) => configure({ ngrokDomain: value.replace(/^https?:\/\//, '').replace(/\/$/, '') || null })}
          />
        )}
        {settings.tunnel === 'custom' && (
          <TextSetting
            label="Address"
            placeholder="https://remote.example.com"
            value={settings.customUrl ?? ''}
            attr="data-remote-custom-url"
            onSave={(value) => configure({ customUrl: value.replace(/\/$/, '') || null })}
          />
        )}
        <ToolHelp tunnel={settings.tunnel} installed={settings.tunnel === 'custom' || status.tools[settings.tunnel]} />
      </div>

      {settings.enabled && <StatusLine status={status} />}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<QrCode size={14} aria-hidden />} disabled={!running} onClick={() => setDialog('pair')} data-remote-pair>
          Pair a phone
        </Button>
        {status.devices.length > 0 && (
          <Button disabled={!running} onClick={() => setDialog('link')} data-remote-link>
            Show the address to paired phones
          </Button>
        )}
      </div>

      <Devices status={status} onRevoke={(deviceId) => void client?.call('remote.revoke', { deviceId }).catch((e: Error) => setError(e.message))} />

      <div className="grid gap-1.5" data-remote-port>
        <TextSetting
          label="Port"
          placeholder=""
          value={String(settings.port)}
          attr="data-remote-port-input"
          inset={false}
          narrow
          onSave={(value) => {
            const port = Number(value);
            if (!Number.isInteger(port) || port < 1024 || port > 65535) return setError('Use a port between 1024 and 65535.');
            configure({ port });
          }}
        />
        <p className="text-meta text-muted">
          While Remote is on, Switchboard listens on <code className="font-mono text-text">http://127.0.0.1:{settings.port}</code>, and the tunnel forwards to it. With your own address, point your tunnel or proxy there. Changing the port restarts Remote.
        </p>
      </div>
      <p className="text-meta text-muted">
        The tunnel's address can be reached from anywhere, but only paired phones get in: every connection is checked with the phone's key and encrypted from the phone to this computer.
      </p>

      {dialog === 'pair' && client && <PairDialog client={client} status={status} onClose={() => setDialog(null)} />}
      {dialog === 'link' && client && <LinkDialog client={client} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StatusLine({ status }: { status: RemoteStatus }) {
  const { problem, tunnel } = status;
  if (problem?.kind === 'port-in-use') return <Notice tone="error">Port {problem.port} is in use by another app. Quit it, or turn Remote off and on to try again.</Notice>;
  if (problem?.kind === 'tool-missing') return <Notice tone="caution">{TUNNELS.find((t) => t.id === problem.tunnel)?.label} isn't installed on this computer. Install it, then choose it again.</Notice>;
  if (problem?.kind === 'failed') return <Notice tone="error">{problem.message}</Notice>;
  const dot = tunnel.state === 'running' ? 'bg-ok' : tunnel.state === 'failed' ? 'bg-error' : 'bg-faint';
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3" role="status" data-remote-status={tunnel.state}>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 text-ui">
        {tunnelLine(status)}
        {status.address && <span className="block truncate font-mono text-meta text-muted">{status.address}</span>}
        {tunnel.state === 'failed' && tunnel.message && <span className="block text-meta text-muted">{tunnel.message}</span>}
      </span>
    </div>
  );
}

function Devices({ status, onRevoke }: { status: RemoteStatus; onRevoke: (deviceId: string) => void }) {
  if (!status.devices.length) return null;
  const connected = new Set(status.connections.map((c) => c.deviceId));
  return (
    <div className="grid gap-2" data-remote-devices>
      <p className="text-ui font-medium">Paired phones</p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {status.devices.map((device) => (
          <li key={device.id} className="flex items-center gap-3 px-4 py-2.5" data-remote-device={device.id}>
            <Smartphone size={15} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui">{device.name}</span>
              <span className="block text-meta text-muted">
                {connected.has(device.id) ? <span className="text-ok">Connected now</span> : device.lastSeenAt ? `Last connected ${remoteAge(device.lastSeenAt)}` : 'Not connected yet'}
                {` · paired ${remoteAge(device.createdAt)}`}
              </span>
            </span>
            <Button variant="danger" size="sm" onClick={() => onRevoke(device.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted">Revoke disconnects a phone at once. Phones that don't connect for 30 days are removed.</p>
    </div>
  );
}

/** A text setting that saves on Enter or when it loses focus. */
function TextSetting({ label, placeholder, value, attr, onSave, inset = true, narrow = false }: { label: string; placeholder: string; value: string; attr: string; onSave(value: string): void; inset?: boolean; narrow?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => draft.trim() !== value && onSave(draft.trim());
  return (
    <label className={`flex items-center gap-2 ${inset ? 'pl-5.5' : ''}`} {...{ [attr]: true }}>
      <span className="shrink-0 text-ui text-muted">{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => event.key === 'Enter' && save()}
        className={narrow ? `${field} max-w-24 flex-none` : field}
      />
    </label>
  );
}

const linkClass = 'inline-flex items-center gap-1 text-meta text-link hover:underline';

function ToolHelp({ tunnel, installed }: { tunnel: RemoteTunnel; installed: boolean }) {
  const info = TUNNELS.find((t) => t.id === tunnel)!;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 pl-5.5">
      {info.note && <span className="text-meta text-muted">{info.note}</span>}
      {!installed && info.install && (
        <a href={info.install} target="_blank" rel="noreferrer" className={linkClass}>
          How to install {info.tool} <ExternalLink size={11} aria-hidden />
        </a>
      )}
    </p>
  );
}
