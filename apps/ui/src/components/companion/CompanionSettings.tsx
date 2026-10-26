import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VSCODE_EXTENSION_URLS } from '@seshboard/protocol/bridge';
import { useEngineConnection } from '../../engine/useEngine.ts';

interface CompanionStatus {
  listening: boolean;
  clients: number;
  error: string | null;
}

/** How often the page asks again, so a window that connects or closes shows up while you look. */
const POLL_MS = 3000;

const link = 'inline-flex items-center gap-1 text-ui text-link hover:underline';

const SENDS = [
  'The lines you have selected, or the open file',
  'Files and folders picked in the Explorer, and open editors',
  'Problems, terminal output and changed files',
];

/** What the VS Code companion does, where to get it, and whether an editor is connected right now. */
export function CompanionSettings() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [status, setStatus] = useState<CompanionStatus | null>(null);

  useEffect(() => {
    if (!client) return;
    let current = true;
    const load = () =>
      client.call('companion.status', {}).then(
        (next) => current && setStatus(next),
        () => current && setStatus(null),
      );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [client]);

  const state = !status ? 'unknown' : status.clients > 0 ? 'connected' : status.listening ? 'waiting' : 'off';
  const dot = state === 'connected' ? 'bg-ok' : state === 'off' && status?.error ? 'bg-error' : 'bg-faint';
  const label =
    state === 'connected'
      ? `Connected to ${status!.clients} editor ${status!.clients === 1 ? 'window' : 'windows'}`
      : state === 'waiting'
        ? 'No editor connected. Install the extension, then open a folder in VS Code.'
        : state === 'off'
          ? status?.error
            ? `Seshboard can't listen for VS Code: ${status.error}`
            : "Seshboard isn't listening for VS Code."
          : 'Checking…';

  return (
    <div className="grid gap-4" data-companion-settings>
      <ul className="grid list-disc gap-1 pl-5 text-ui text-muted">
        {SENDS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3" role="status" data-companion-status={state}>
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 text-ui">{label}</span>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <a href={VSCODE_EXTENSION_URLS.marketplace} target="_blank" rel="noreferrer" className={link} data-companion-link="marketplace">
          Visual Studio Marketplace <ExternalLink size={11} aria-hidden />
        </a>
        <a href={VSCODE_EXTENSION_URLS.openVsx} target="_blank" rel="noreferrer" className={link} data-companion-link="open-vsx">
          Open VSX (Cursor, Windsurf) <ExternalLink size={11} aria-hidden />
        </a>
        <a href={VSCODE_EXTENSION_URLS.guide} target="_blank" rel="noreferrer" className={link} data-companion-link="guide">
          How it works <ExternalLink size={11} aria-hidden />
        </a>
      </p>
    </div>
  );
}
