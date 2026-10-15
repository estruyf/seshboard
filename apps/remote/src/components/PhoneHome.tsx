import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { RemoteProfileUsage, RemoteSessions } from '@switchboard/protocol/remote-client';
import type { ConnectionState } from '../lib/connection.ts';
import { homeHeadline } from '../lib/groups.ts';
import { ConnectionChip } from './ConnectionStatus.tsx';
import { MenuButton, type MenuItem } from './Menu.tsx';
import { useNow } from './SessionList.tsx';
import { UsageSection } from './Usage.tsx';
import { Button, Logo } from './ui.tsx';

/**
 * A phone's Home, where the app opens: what waits in the sessions (a tap opens the list) and how much of each
 * profile's plan is used. Home and the list take each other's place (the list's Home button comes back here), so the
 * back gesture never goes between them.
 */
export function PhoneHome({
  sessions,
  usage,
  state,
  banner,
  computer,
  menu,
  top,
  onSessions,
  onNew,
  onHelp,
}: {
  sessions: RemoteSessions;
  usage: RemoteProfileUsage[] | null;
  state: ConnectionState;
  banner: ReactNode;
  computer: string;
  menu: MenuItem[];
  /** Above everything: the offer to turn on notifications. */
  top?: ReactNode;
  onSessions: () => void;
  onNew: () => void;
  onHelp: () => void;
}) {
  const now = useNow();
  const headline = homeHeadline(sessions.sessions, now);
  const needsYou = sessions.sessions.some((s) => s.status === 'needs-you');
  const offline = state.kind !== 'connected';
  return (
    <div className="flex h-full min-h-0 flex-col" data-remote-phone-home>
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 bg-inherit px-4 pb-2">
        <Logo className="size-6" />
        <h1 className="flex-1 text-title font-semibold">Home</h1>
        <ConnectionChip state={state} computer={computer} onHelp={onHelp} />
        <MenuButton items={menu} />
      </header>
      {banner}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4" data-remote-scroll>
        {top}
        <div className="px-3">
          <button
            type="button"
            onClick={onSessions}
            className={`mt-3 flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-border/45 active:bg-selected ${needsYou ? 'border-2 border-warn' : 'border-border'}`}
            data-remote-home-sessions
          >
            <span className="min-w-0 flex-1">
              <span className={`block text-body font-semibold ${needsYou ? 'text-warn' : ''}`}>{headline.title}</span>
              {headline.counts && <span className="block text-meta text-muted">{headline.counts}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
          </button>
          <UsageSection usage={usage} offline={offline} className="pt-2" />
        </div>
      </main>
      <footer className="safe-bottom border-t border-border bg-inherit px-4 pt-2">
        <Button variant="primary" onClick={onNew} disabled={offline} className="w-full" data-remote-new>
          <Plus className="size-4" aria-hidden />
          New session
        </Button>
        {offline && <p className="pt-1 text-center text-meta text-faint">New session needs the connection.</p>}
      </footer>
    </div>
  );
}
