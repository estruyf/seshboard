import { ChevronDown, CircleHelp, PlugZap, RotateCw } from 'lucide-react';
import { stateLine } from '../lib/computer.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { offlineHelp, offlineLine, reconnectingLine, type OfflineReason } from '../lib/offline.ts';
import { AnchoredMenu, type MenuItem } from './Menu.tsx';
import { Sheet } from './Sheet.tsx';
import { useNow } from './SessionList.tsx';
import { Button } from './ui.tsx';

/** The Remote access page of the docs, on the site the app comes from. */
const DOCS = 'https://switchboard.struyfconsulting.com/remote-access/';

type Look = { dot: string; text: string; label: string };

function look(state: ConnectionState, computer: string): Look {
  if (state.kind === 'connected') return { dot: 'bg-ok', text: 'text-muted', label: computer || 'Connected' };
  if (state.kind === 'disconnected') return { dot: 'bg-faint', text: 'text-muted', label: 'Disconnected' };
  if (state.kind === 'offline' && state.retryAt === null) return { dot: 'bg-error', text: 'text-error', label: 'Offline' };
  if (state.kind === 'connecting' && state.attempt === 0) return { dot: 'bg-caution pulse-dot', text: 'text-muted', label: 'Connecting…' };
  return { dot: 'bg-caution pulse-dot', text: 'text-caution', label: 'Reconnecting…' };
}

/**
 * The computer chip in the first screen's and the drawer's header ("● Elio's iMac ▾"): the computer's name with a
 * green dot while connected, amber while it retries, red once it gave up, grey after Disconnect. It opens the
 * computer's menu: its name and state, Disconnect (or Connect), and Forget this computer… under a line.
 */
export function ComputerChip({ state, computer, onDisconnect, onConnect, onForget }: { state: ConnectionState; computer: string; onDisconnect: () => void; onConnect: () => void; onForget: () => void }) {
  const now = useNow();
  const { dot, text, label } = look(state, computer);
  const items: MenuItem[] = [
    { kind: 'header', title: computer || 'Your computer', detail: stateLine(state, now) },
    state.kind === 'disconnected' ? { label: 'Connect', onSelect: onConnect } : { label: 'Disconnect', onSelect: onDisconnect },
    { kind: 'separator' },
    { label: 'Forget this computer…', danger: true, onSelect: onForget },
  ];
  return (
    <AnchoredMenu label={computer || 'Your computer'} items={items} className="min-w-0">
      {(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={`${computer || 'Your computer'}: ${stateLine(state, now)}`}
          data-remote-connection={state.kind}
          data-remote-computer-chip
          className={`flex min-h-9 max-w-44 items-center gap-1.5 rounded-full border border-border pr-1.5 pl-2.5 text-meta hover:bg-border/45 pointer-fine:min-h-6 ${text}`}
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-faint" />
        </button>
      )}
    </AnchoredMenu>
  );
}

/** Why the phone is offline, as far as it can tell. */
export const reasonOf = (state: ConnectionState): OfflineReason => (state.kind === 'offline' ? state.reason : 'unknown');

/**
 * Under the header while the connection is down: why, when the phone can tell, and what to do (Help, Try again). The
 * `caution` tone: something outside Switchboard stops it.
 */
export function ConnectionBanner({ state, computer, onHelp, onRetry, onConnect }: { state: ConnectionState; computer: string; onHelp: () => void; onRetry: () => void; onConnect: () => void }) {
  if (state.kind === 'connected' || state.kind === 'unpaired') return null;
  // Disconnect was your choice: a quiet line, not the caution of a connection that broke.
  if (state.kind === 'disconnected') {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border bg-sidebar px-4 py-2" data-remote-banner="disconnected">
        <PlugZap className="size-4 shrink-0 text-faint" aria-hidden />
        <p className="min-w-0 flex-1 text-ui text-text">Disconnected from {computer || 'your computer'}</p>
        <Button variant="primary" size="md" onClick={onConnect} data-remote-connect>
          Connect
        </Button>
      </div>
    );
  }
  if (state.kind === 'connecting' && state.attempt === 0) return null;
  const line = state.kind === 'offline' ? offlineLine(state.reason, computer || 'your computer') : null;
  const gaveUp = state.kind === 'offline' && state.retryAt === null;
  const status = gaveUp ? 'Stopped trying.' : reconnectingLine(state.attempt);
  return (
    <div role="status" className="flex items-center gap-2 border-b border-caution/30 bg-caution/10 px-4 py-2" data-remote-banner>
      <div className="min-w-0 flex-1">
        {line && <p className="text-ui font-semibold text-text">{line}</p>}
        <p className={`text-meta ${line ? 'text-muted' : 'text-ui text-text'}`}>{status}</p>
      </div>
      {gaveUp && (
        <Button variant="quiet" size="md" onClick={onRetry} className="text-caution!">
          <RotateCw className="size-4" aria-hidden />
          Try again
        </Button>
      )}
      <Button variant="quiet" size="md" onClick={onHelp} className="text-caution!" data-remote-help>
        <CircleHelp className="size-4" aria-hidden />
        Help
      </Button>
    </div>
  );
}

/** The Help sheet: the cause in two or three sentences, and a link to the docs. */
export function OfflineHelp({ state, computer, address, onClose, onRetry }: { state: ConnectionState; computer: string; address: string; onClose: () => void; onRetry: () => void }) {
  const help = offlineHelp(reasonOf(state), computer || 'your computer', address);
  return (
    <Sheet
      title={help.title}
      onClose={onClose}
      hook="offline-help"
      footer={
        <div className="flex gap-2">
          <a href={DOCS} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-edge px-4 text-ui hover:bg-border/45 pointer-fine:min-h-8">
            Remote access docs
          </a>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              onRetry();
              onClose();
            }}
          >
            Try again
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-body text-muted">
        {help.text.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </Sheet>
  );
}
