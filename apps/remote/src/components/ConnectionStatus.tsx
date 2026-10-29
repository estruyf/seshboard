import { ChevronDown, CircleHelp, Laptop, PlugZap, RotateCw, TriangleAlert, Unplug } from 'lucide-react';
import { computerRowLine, otherLine, stateLine, type StateTone } from '../lib/computer.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { offlineHelp, offlineLine, type OfflineReason } from '../lib/offline.ts';
import { AnchoredMenu, type MenuItem } from './Menu.tsx';
import { Sheet } from './Sheet.tsx';
import { useNow } from './SessionList.tsx';
import { Button } from './ui.tsx';

/** The Remote access page of the docs, on the site the app comes from. */
const DOCS = 'https://seshboard.app/remote-access/';

type Look = { dot: string; text: string; label: string; word: string };

function look(state: ConnectionState, computer: string): Look {
  if (state.kind === 'connected') return { dot: 'bg-ok', text: 'text-muted', label: computer || 'Connected', word: 'Connected' };
  if (state.kind === 'disconnected') return { dot: 'bg-faint', text: 'text-muted', label: 'Disconnected', word: 'Disconnected' };
  if (state.kind === 'unpaired') return { dot: 'bg-error', text: 'text-error', label: 'Pair again', word: 'Pair again' };
  if (state.kind === 'offline' && state.retryAt === null) return { dot: 'bg-error', text: 'text-error', label: 'Offline', word: 'Offline' };
  if (state.kind === 'connecting' && state.attempt === 0) return { dot: 'bg-caution pulse-dot', text: 'text-muted', label: 'Connecting…', word: 'Connecting…' };
  return { dot: 'bg-caution pulse-dot', text: 'text-caution', label: 'Reconnecting…', word: 'Reconnecting…' };
}

/** Another paired computer, in the computer's menu: a tap switches to it. */
export interface OtherComputer {
  id: string;
  name: string;
  state: ConnectionState;
  needsYou: number;
  onSwitch: () => void;
}

/** What opens the computer's menu: the chip, Home's title, or the drawer's computer row. */
export interface ComputerProps {
  state: ConnectionState;
  computer: string;
  /**
   * One of the chips of every computer, with more than one paired (each on screen, in the same list): the chip always
   * says its name and how many of its sessions need you, and its menu only has what is its own.
   */
  strip?: boolean;
  needsYou?: number;
  /** The other paired computers, to switch to (not in the strip: each has its own chip there). */
  others?: readonly OtherComputer[];
  onDisconnect: () => void;
  onConnect: () => void;
  onForget: () => void;
}

/**
 * The computer's menu: its name and state, the other computers to switch to, Disconnect (or Connect), and Forget
 * this computer… under a line. Pairing another is in Settings.
 */
function computerItems({ state, computer, others = [], onDisconnect, onConnect, onForget }: ComputerProps, now: number): MenuItem[] {
  const connection: MenuItem[] = state.kind === 'unpaired' ? [] : [state.kind === 'disconnected' ? { label: 'Connect', onSelect: onConnect, hook: 'connect' } : { label: 'Disconnect', onSelect: onDisconnect, hook: 'disconnect' }];
  const switches: MenuItem[] = others.map((other) => ({ label: `Switch to ${other.name || 'your computer'}`, hint: otherLine(other.state, other.needsYou) || undefined, onSelect: other.onSwitch, hook: 'switch' }));
  return [
    { kind: 'header', title: computer || 'Your computer', detail: stateLine(state, now) },
    ...(switches.length ? [...switches, { kind: 'separator' } as const] : []),
    ...connection,
    { kind: 'separator' },
    { label: 'Forget this computer…', danger: true, onSelect: onForget, hook: 'forget' },
  ];
}

/** The dot of a computer's state (`computerRowLine`). */
export const TONE_DOT: Record<StateTone, string> = { ok: 'bg-ok', caution: 'bg-caution pulse-dot', error: 'bg-error', faint: 'bg-faint' };

/**
 * The drawer's computer row, pinned to its bottom: a laptop in a tile, the name, how it is ("● Connected · encrypted")
 * and ▾. A tap opens the computer's menu above it.
 */
export function ComputerRow(props: ComputerProps) {
  const { state, computer } = props;
  const now = useNow();
  const name = computer || 'Your computer';
  const line = computerRowLine(state);
  return (
    <AnchoredMenu label={name} items={computerItems(props, now)} align="left" side="above" className="flex">
      {(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={`${name}: ${line.text}`}
          data-remote-connection={state.kind}
          data-remote-drawer-computer
          className="mx-2 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-border/45 active:bg-selected"
        >
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <Laptop className="size-4 text-muted" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold">{name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[line.tone]}`} />
              <span className="truncate">{line.text}</span>
            </span>
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-faint" />
        </button>
      )}
    </AnchoredMenu>
  );
}

/**
 * The computer chip in the wide sidebar's header and the strip of every computer ("● Elio's iMac ▾"): the computer's name with a green
 * dot while connected, amber while it retries, red once it gave up, grey after Disconnect. It opens the computer's
 * menu. In the strip of every computer, it says the name whatever the state, and in `warn` how many sessions there
 * need you.
 */
export function ComputerChip(props: ComputerProps) {
  const { state, computer, strip = false, needsYou = 0 } = props;
  const now = useNow();
  const { dot, text: tone, label: stateLabel } = look(state, computer);
  const label = strip ? computer || 'Your computer' : stateLabel;
  const text = strip && state.kind !== 'offline' && state.kind !== 'unpaired' ? 'text-muted' : tone;
  const waiting = strip && state.kind === 'connected' && needsYou > 0;
  return (
    <AnchoredMenu label={computer || 'Your computer'} items={computerItems(props, now)} align={strip ? 'left' : 'right'} className="min-w-0">
      {(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={`${computer || 'Your computer'}: ${stateLine(state, now)}${waiting ? `, ${otherLine(state, needsYou)}` : ''}`}
          data-remote-connection={state.kind}
          data-remote-computer-chip
          className={`flex min-h-9 max-w-44 shrink-0 items-center gap-1.5 rounded-full border border-border pr-1.5 pl-2.5 text-meta hover:bg-border/45 pointer-fine:min-h-6 ${text}`}
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">{label}</span>
          {waiting && (
            <span aria-hidden className="shrink-0 font-semibold text-warn tabular-nums">
              {needsYou}
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-faint" />
        </button>
      )}
    </AnchoredMenu>
  );
}

/** Home's title on a phone, which opens the computer's menu as the chip does: the computer's name with ▾. */
export function ComputerTitle(props: ComputerProps) {
  const { state, computer } = props;
  const now = useNow();
  const name = computer || 'Your computer';
  return (
    <AnchoredMenu label={name} items={computerItems(props, now)} align="left" className="flex min-w-0">
      {(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={`${name}: ${stateLine(state, now)}`}
          data-remote-connection={state.kind}
          data-remote-computer-title
          className="flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-2 text-title font-semibold hover:bg-border/45"
        >
          <span className="truncate">{name}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-faint" />
        </button>
      )}
    </AnchoredMenu>
  );
}

/** The line under Home's title: "● Connected · 2 need you". */
export function ConnectionLine({ state, detail }: { state: ConnectionState; detail: string }) {
  const { dot, text, word } = look(state, '');
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-remote-connection-line={state.kind}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className={`shrink-0 ${text}`}>{word}</span>
      <span className="truncate">· {detail}</span>
    </p>
  );
}

/** Why the phone is offline, as far as it can tell. */
export const reasonOf = (state: ConnectionState): OfflineReason => (state.kind === 'offline' ? state.reason : 'unknown');

/**
 * Under the header while the connection is down: one short line ("Can't reach Elio's iMac · Reconnecting…") that opens
 * the Help sheet with the why, and Try again once it stopped trying. One line, so a computer that is away doesn't take
 * the sidebar. The `caution` tone: something outside Seshboard stops it.
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
  const line = offlineLine(reasonOf(state), computer || 'your computer');
  const gaveUp = state.kind === 'offline' && state.retryAt === null;
  const status = gaveUp ? 'Stopped trying' : 'Reconnecting…';
  return (
    <div role="status" className="flex items-center gap-2 border-b border-caution/30 bg-caution/10 px-4" data-remote-banner>
      <button
        type="button"
        onClick={onHelp}
        aria-label={`${line}. ${status}. Help`}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left text-meta pointer-fine:min-h-7"
        data-remote-help
      >
        <span className="truncate text-text">{line}</span>
        <span className="shrink-0 text-muted">· {status}</span>
        <CircleHelp className="ml-auto size-3.5 shrink-0 text-caution" aria-hidden />
      </button>
      {gaveUp && (
        <Button variant="quiet" size="md" onClick={onRetry} className="-mr-2.5 min-h-9! text-meta text-caution! pointer-fine:min-h-7!">
          <RotateCw className="size-3.5" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Under the header while a computer sent a session list this app can't read (`checkRemoteSessions`): it may run an
 * older or newer Seshboard. The list shows what could be read.
 */
export function UnreadableBanner({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-caution/30 bg-caution/10 px-4 py-2" data-remote-banner="unreadable">
      <TriangleAlert className="size-4 shrink-0 text-caution" aria-hidden />
      <p className="min-w-0 flex-1 text-meta text-text">{problem}</p>
    </div>
  );
}

/**
 * With more than one computer, under the header while one of them refused this phone (its pairing was revoked): the
 * others work as before, so it only says so, with Forget. With one computer, the whole screen says it instead.
 */
export function UnpairedBanner({ state, computer, onForget }: { state: ConnectionState; computer: string; onForget: () => void }) {
  if (state.kind !== 'unpaired') return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-4 py-2" data-remote-banner="unpaired">
      <Unplug className="size-4 shrink-0 text-error" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold text-text">Pair again with {computer || 'your computer'}</p>
        <p className="text-meta text-muted">{state.message}</p>
      </div>
      <Button variant="danger" size="md" onClick={onForget}>
        Forget
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
