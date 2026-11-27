import { Loader2, Unplug, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BrowserExtensionHostStatus } from '@seshboard/protocol/bridge';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { browserExtensionLabel } from './browserExtension.ts';

/** How often the page asks again, so a browser that connects or closes shows up while you look. */
const POLL_MS = 3000;

const SENDS = ['The text you select on a page, with its address', 'A page, to start a session in the project it belongs to', 'Nothing goes to Claude until you send it in Seshboard'];

/**
 * Settings › Browser extension: connects the browsers on this computer to Seshboard (main installs the extension's
 * native messaging host for each one), and shows whether a browser is connected right now.
 */
export function BrowserExtensionSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [host, setHost] = useState<BrowserExtensionHostStatus | null>(null);
  const [connected, setConnected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const check = () => void window.seshboard?.browserExtensionHost().then((result) => live && setHost(result.status), () => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  useEffect(() => {
    if (!client) return;
    let current = true;
    const load = () =>
      client.call('companion.status', {}).then(
        (next) => current && setConnected(next.browsers),
        () => current && setConnected(null),
      );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [client]);

  const run = (action: 'install' | 'remove') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    window.seshboard
      ?.browserExtensionHost(action)
      .then(
        (result) => {
          setHost(result.status);
          setError(result.error);
        },
        (failed: unknown) => setError(failed instanceof Error ? failed.message : String(failed)),
      )
      .finally(() => setBusy(false));
  };

  const state = connected && connected > 0 ? 'connected' : host?.installed ? 'waiting' : 'off';
  const dot = state === 'connected' ? 'bg-ok' : 'bg-faint';

  return (
    <div className="grid gap-4" data-browser-extension-settings>
      <ul className="grid list-disc gap-1 pl-5 text-ui text-muted">
        {SENDS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3" role="status" data-browser-extension-status={state}>
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 text-ui" data-browser-extension-label>{host ? browserExtensionLabel(host, connected ?? 0) : 'Checking…'}</span>
        {host && (
          <Button
            size="sm"
            variant={host.installed ? 'secondary' : 'primary'}
            className="shrink-0"
            icon={busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : host.installed ? <Unplug size={12} aria-hidden /> : <Plug size={12} aria-hidden />}
            aria-busy={busy}
            onClick={() => run(host.installed ? 'remove' : 'install')}
            data-browser-extension-action={host.installed ? 'remove' : 'install'}
          >
            {host.installed ? 'Disconnect' : 'Connect browsers'}
          </Button>
        )}
      </div>
      {host && host.browsers.length > 0 && (
        <ul className="grid gap-1 text-ui" aria-label="Browsers" data-browser-extension-browsers>
          {host.browsers.map((browser) => (
            <li key={browser.id} className="flex items-center justify-between gap-4" data-browser-extension-browser={browser.id}>
              <span>{browser.name}</span>
              <span className="text-meta text-muted">{browser.registered ? 'Connected' : 'Not connected'}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <span className="text-meta text-error" role="alert" data-browser-extension-error>
          {error}
        </span>
      )}
    </div>
  );
}
