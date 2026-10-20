import { CalendarClock, House } from 'lucide-react';
import type { ReactNode } from 'react';
import { ariaShortcut, keysFor } from '../../lib/shortcuts.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openUpcoming } from '../../state/upcomingStore.ts';
import { useUpcomingSummary } from '../../state/useUpcomingSummary.ts';
import { CountBadge } from '../ui/Pill.tsx';

/** One row of the sidebar's nav: a link to a main view, selected while it shows. */
function NavRow({ icon, label, selected, onClick, ariaLabel, shortcut, children, data }: { icon: ReactNode; label: string; selected: boolean; onClick(): void; ariaLabel?: string; shortcut?: string; children?: ReactNode; data: Record<`data-${string}`, boolean> }) {
  return (
    <button
      type="button"
      role="link"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      aria-label={ariaLabel ?? label}
      aria-keyshortcuts={shortcut}
      className={`no-drag flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-ui ${selected ? 'bg-selected font-semibold text-text' : 'text-text/90 hover:bg-border/45'}`}
      {...data}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

/**
 * Home and Upcoming, under the search row. Upcoming says what matters most before its count (queued items plus active
 * schedules): an item that is ready, else the next run; "nothing planned" with nothing at all.
 */
export function SidebarNav({ now }: { now: number }) {
  // Home is the main area with no session open; both stay selected behind Settings opened from them.
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.layout === null);
  const atUpcoming = useSessions((s) => s.view === 'upcoming' || (s.view === 'settings' && s.settingsFrom === 'upcoming'));
  const summary = useUpcomingSummary(now);
  return (
    <nav aria-label="Views" className="grid gap-0.5 px-3 pb-1.5">
      <NavRow icon={<House size={15} aria-hidden />} label="Home" selected={atHome} onClick={() => useSessions.getState().goHome()} shortcut={ariaShortcut(keysFor('home'))} data={{ 'data-go-home': true }} />
      <NavRow
        icon={<CalendarClock size={15} aria-hidden />}
        label="Upcoming"
        ariaLabel={summary.label}
        selected={atUpcoming}
        onClick={() => openUpcoming()}
        shortcut={ariaShortcut(keysFor('upcoming'))}
        data={{ 'data-upcoming-nav': true }}
      >
        {summary.hint && (
          <span className={`shrink-0 text-meta tabular-nums ${summary.hint.tone === 'ok' ? 'text-ok' : 'text-muted'}`} data-upcoming-nav-hint>
            {summary.hint.text}
          </span>
        )}
        {summary.count > 0 && <CountBadge count={summary.count} />}
      </NavRow>
    </nav>
  );
}
