import { CircleHelp, RotateCw } from 'lucide-react';
import type { ConnectionState } from '../lib/connection.ts';
import { offlineHelp, offlineLine, reconnectingLine, type OfflineReason } from '../lib/offline.ts';
import { Sheet } from './Sheet.tsx';
import { Button } from './ui.tsx';

/** The Remote access page of the docs, on the site the app comes from. */
const DOCS = 'https://switchboard.struyfconsulting.com/remote-access/';

type Look = { dot: string; text: string; label: string };

function look(state: ConnectionState, computer: string): Look {
  if (state.kind === 'connected') return { dot: 'bg-ok', text: 'text-muted', label: computer || 'Connected' };
  if (state.kind === 'offline' && state.retryAt === null) return { dot: 'bg-error', text: 'text-error', label: 'Offline' };
  if (state.kind === 'connecting' && state.attempt === 0) return { dot: 'bg-caution pulse-dot', text: 'text-muted', label: 'Connecting…' };
  return { dot: 'bg-caution pulse-dot', text: 'text-caution', label: 'Reconnecting…' };
}

/**
 * The chip in the list's header: the computer's name with a green dot while connected, amber while it retries, red
 * once it gave up. Not connected, it opens the offline help.
 */
export function ConnectionChip({ state, computer, onHelp }: { state: ConnectionState; computer: string; onHelp: () => void }) {
  const { dot, text, label } = look(state, computer);
  const connected = state.kind === 'connected';
  return (
    <button
      type="button"
      onClick={connected ? undefined : onHelp}
      aria-disabled={connected || undefined}
      aria-label={connected ? `Connected to ${computer || 'your computer'}` : `${label} Show why`}
      data-remote-connection={state.kind}
      className={`flex min-h-9 max-w-44 items-center gap-1.5 rounded-full border border-border px-2.5 text-meta pointer-fine:min-h-6 ${text} ${connected ? 'cursor-default!' : 'hover:bg-border/45'}`}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Why the phone is offline, as far as it can tell. */
export const reasonOf = (state: ConnectionState): OfflineReason => (state.kind === 'offline' ? state.reason : 'unknown');

/**
 * Under the header while the connection is down: why, when the phone can tell, and what to do (Help, Try again). The
 * `caution` tone: something outside Switchboard stops it.
 */
export function ConnectionBanner({ state, computer, onHelp, onRetry }: { state: ConnectionState; computer: string; onHelp: () => void; onRetry: () => void }) {
  if (state.kind === 'connected' || state.kind === 'unpaired') return null;
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
