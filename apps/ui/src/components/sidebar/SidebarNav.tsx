import { CalendarClock, Clock, Globe, House } from 'lucide-react';
import type { ReactNode } from 'react';
import { ariaShortcut, keysFor } from '../../lib/shortcuts.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openActivity } from '../../state/activityStore.ts';
import { openBrowserView, useSidebarList } from '../../state/browserViewStore.ts';
import { useTabCount } from '../../state/webPreviewStore.ts';
import { BROWSER_OWNER } from '../webPreview/browserTabs.ts';
import { Button } from '../ui/Button.tsx';
import { openUpcoming } from '../../state/upcomingStore.ts';
import { useSessionsToday } from '../../state/useSessionsToday.ts';
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
 * Home, Upcoming and Activity, under the search row. Upcoming says what matters most before its count (queued items plus
 * active schedules): an item that is ready, else the next run; "nothing planned" with nothing at all. Activity says how
 * many sessions you had today.
 */
export function SidebarNav({ now }: { now: number }) {
  // Home is the main area with no session open; both stay selected behind Settings opened from them.
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.layout === null);
  const atUpcoming = useSessions((s) => s.view === 'upcoming' || (s.view === 'settings' && s.settingsFrom === 'upcoming'));
  const atActivity = useSessions((s) => s.view === 'activity' || (s.view === 'settings' && s.settingsFrom === 'activity'));
  const summary = useUpcomingSummary(now);
  const today = useSessionsToday(now);
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
      <NavRow
        icon={<Clock size={15} aria-hidden />}
        label="Activity"
        ariaLabel={today > 0 ? `Activity, ${today} today` : 'Activity'}
        selected={atActivity}
        onClick={() => openActivity()}
        shortcut={ariaShortcut(keysFor('activity'))}
        data={{ 'data-activity-nav': true }}
      >
        {today > 0 && (
          <span className="shrink-0 text-meta text-muted tabular-nums" data-activity-nav-hint>
            {today} today
          </span>
        )}
      </NavRow>
    </nav>
  );
}

/** A count on a nav icon's corner. */
function IconBadge({ count, data }: { count: number; data: Record<`data-${string}`, boolean> }) {
  return (
    <span aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-border px-1 text-[10px] leading-none font-semibold text-text tabular-nums ring-2 ring-sidebar" {...data}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * With Browser (preview) on: Home, Upcoming, Activity and Browser as one row of icons above the search box. Each keeps
 * its shortcut and says in its tooltip what its row said ("Upcoming · nothing planned"). Home has a dot while anything
 * needs you, as the list may show the Browser's tabs instead. Picking Home, Upcoming or Activity shows the sessions
 * again; Browser shows its tabs in the list and its page in the main area.
 */
export function NavIcons({ now, needsYou }: { now: number; needsYou: number }) {
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.layout === null);
  const atUpcoming = useSessions((s) => s.view === 'upcoming' || (s.view === 'settings' && s.settingsFrom === 'upcoming'));
  const atActivity = useSessions((s) => s.view === 'activity' || (s.view === 'settings' && s.settingsFrom === 'activity'));
  const atBrowser = useSessions((s) => s.view === 'browser' || (s.view === 'settings' && s.settingsFrom === 'browser'));
  const summary = useUpcomingSummary(now);
  const today = useSessionsToday(now);
  const tabs = useTabCount(BROWSER_OWNER);
  const sessions = () => useSidebarList.getState().setList('sessions');
  const homeTip = needsYou > 0 ? `Home · ${needsYou} need${needsYou === 1 ? 's' : ''} you` : 'Home';
  const upcomingTip = `Upcoming · ${summary.hint?.text ?? (summary.count > 0 ? `${summary.count} planned` : 'nothing planned')}`;
  const activityTip = today > 0 ? `Activity · ${today} today` : 'Activity';
  const browserTip = tabs > 0 ? `Browser · ${tabs} ${tabs === 1 ? 'tab' : 'tabs'}` : 'Browser';
  const look = 'no-drag relative w-9! rounded-lg!';
  return (
    <nav aria-label="Views" className="flex items-center gap-1 px-3 pb-1.5" data-nav-icons>
      <Button variant="quiet" size="lg" iconOnly icon={<House size={16} aria-hidden />} aria-label={homeTip} shortcut="home" selected={atHome} aria-current={atHome ? 'page' : undefined} data-tooltip={homeTip} data-go-home data-nav="home" onClick={() => (sessions(), useSessions.getState().goHome())} className={look}>
        {needsYou > 0 && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full bg-warn ring-2 ring-sidebar" data-nav-needs-you />}
      </Button>
      <Button variant="quiet" size="lg" iconOnly icon={<CalendarClock size={16} aria-hidden />} aria-label={upcomingTip} shortcut="upcoming" selected={atUpcoming} aria-current={atUpcoming ? 'page' : undefined} data-tooltip={upcomingTip} data-upcoming-nav data-nav="upcoming" onClick={() => (sessions(), openUpcoming())} className={look}>
        {summary.count > 0 && <IconBadge count={summary.count} data={{ 'data-nav-upcoming-count': true }} />}
      </Button>
      <Button variant="quiet" size="lg" iconOnly icon={<Clock size={16} aria-hidden />} aria-label={activityTip} shortcut="activity" selected={atActivity} aria-current={atActivity ? 'page' : undefined} data-tooltip={activityTip} data-activity-nav data-nav="activity" onClick={() => (sessions(), openActivity())} className={look}>
        {today > 0 && <IconBadge count={today} data={{ 'data-nav-activity-count': true }} />}
      </Button>
      <Button variant="quiet" size="lg" iconOnly icon={<Globe size={16} aria-hidden />} aria-label={browserTip} shortcut="browser.view" selected={atBrowser} aria-current={atBrowser ? 'page' : undefined} data-tooltip={browserTip} data-nav="browser" onClick={openBrowserView} className={look}>
        {tabs > 0 && <IconBadge count={tabs} data={{ 'data-nav-browser-count': true }} />}
      </Button>
    </nav>
  );
}
