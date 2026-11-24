import { CalendarClock, Clock, Globe, House } from 'lucide-react';
import { openActivity } from '../../state/activityStore.ts';
import { openBrowserView, useSidebarList } from '../../state/browserViewStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openUpcoming } from '../../state/upcomingStore.ts';
import { useSessionsToday } from '../../state/useSessionsToday.ts';
import { useUpcomingSummary } from '../../state/useUpcomingSummary.ts';
import { useTabCount } from '../../state/webPreviewStore.ts';
import type { ShortcutId } from '../../lib/shortcuts.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { Badged } from '../ui/Badged.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Button } from '../ui/Button.tsx';
import { BROWSER_OWNER } from '../webPreview/browserTabs.ts';

/**
 * Home, Upcoming, Activity and (with Settings › General › Enable browser on) Browser, as one row of icons of equal width
 * above the search box. Each keeps its shortcut and says in its tooltip what it holds ("Upcoming · 2 ready", "Activity ·
 * 20 today"). Home has a dot while anything needs you, as the list may show the Browser's tabs instead. Picking Home,
 * Upcoming or Activity shows the sessions again; Browser shows its tabs in the list and its page in the main area.
 */
export function SidebarNav({ now, needsYou }: { now: number; needsYou: number }) {
  // Home is the main area with no session open; each stays selected behind Settings opened from it.
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.layout === null);
  const atUpcoming = useSessions((s) => s.view === 'upcoming' || (s.view === 'settings' && s.settingsFrom === 'upcoming'));
  const atActivity = useSessions((s) => s.view === 'activity' || (s.view === 'settings' && s.settingsFrom === 'activity'));
  const atBrowser = useSessions((s) => s.view === 'browser' || (s.view === 'settings' && s.settingsFrom === 'browser'));
  const browser = usePreferences((s) => s.prefs.browserEnabled);
  const summary = useUpcomingSummary(now);
  const today = useSessionsToday(now);
  const tabs = useTabCount(BROWSER_OWNER);
  const sessions = () => useSidebarList.getState().setList('sessions');
  const homeTip = needsYou > 0 ? `Home · ${needsYou} need${needsYou === 1 ? 's' : ''} you` : 'Home';
  const upcomingTip = `Upcoming · ${summary.hint?.text ?? (summary.count > 0 ? `${summary.count} planned` : 'nothing planned')}`;
  const activityTip = today > 0 ? `Activity · ${today} today` : 'Activity';
  const browserTip = tabs > 0 ? `Browser · ${tabs} ${tabs === 1 ? 'tab' : 'tabs'}` : 'Browser';
  const look = 'no-drag w-full! rounded-lg!';
  return (
    // One tray of equal icons, tinted apart from the sidebar, as a card is.
    <nav aria-label="Views" className="mx-3 mb-2 grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-bg/50 p-1" data-nav-icons>
      <Button variant="quiet" size="lg" iconOnly icon={<Badged icon={<House size={16} aria-hidden />} dot={needsYou > 0} />} aria-label={homeTip} shortcut="home" selected={atHome} aria-current={atHome ? 'page' : undefined} data-tooltip={homeTip} data-go-home data-nav="home" onClick={() => (sessions(), useSessions.getState().goHome())} className={look} />
      <Button
        variant="quiet"
        size="lg"
        iconOnly
        icon={<Badged icon={<CalendarClock size={16} aria-hidden />} count={summary.count} tone={summary.ready > 0 ? 'ok' : 'default'} data={{ 'data-nav-upcoming-count': true }} />}
        aria-label={upcomingTip}
        shortcut="upcoming"
        selected={atUpcoming}
        aria-current={atUpcoming ? 'page' : undefined}
        data-tooltip={upcomingTip}
        data-upcoming-nav
        data-nav="upcoming"
        onClick={() => (sessions(), openUpcoming())}
        className={look}
      />
      <Button
        variant="quiet"
        size="lg"
        iconOnly
        // No count on the icon: today's sessions are in its tooltip, not something to clear.
        icon={<Clock size={16} aria-hidden />}
        aria-label={activityTip}
        shortcut="activity"
        selected={atActivity}
        aria-current={atActivity ? 'page' : undefined}
        data-tooltip={activityTip}
        data-activity-nav
        data-nav="activity"
        onClick={() => (sessions(), openActivity())}
        className={look}
      />
      {browser && (
        <Button
          variant="quiet"
          size="lg"
          iconOnly
          icon={<Globe size={16} aria-hidden />}
          aria-label={browserTip}
          shortcut="browser.view"
          selected={atBrowser}
          aria-current={atBrowser ? 'page' : undefined}
          data-tooltip={browserTip}
          data-nav="browser"
          onClick={openBrowserView}
          className={look}
        />
      )}
    </nav>
  );
}

/**
 * Minimal mode's top of the sidebar: plain words instead of the icon tray and its badges. New session (with its
 * shortcut on the right), then Search, Upcoming, Activity and Browser, muted, the current one in the text colour. Home
 * stays on its shortcut and in the palette. Counts are in each one's tooltip.
 */
export function MinimalNav({ now, onNewSession, newSessionLabel }: { now: number; onNewSession(): void; newSessionLabel: string }) {
  const view = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const browser = usePreferences((s) => s.prefs.browserEnabled);
  const summary = useUpcomingSummary(now);
  const today = useSessionsToday(now);
  const tabs = useTabCount(BROWSER_OWNER);
  const sessions = () => useSidebarList.getState().setList('sessions');
  const item = 'no-drag flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-ui hover:bg-border/45 hover:text-text';
  const entry = (key: string, label: string, tip: string, current: boolean, onClick: () => void, shortcut?: ShortcutId) => (
    <button key={key} type="button" className={`${item} ${current ? 'bg-selected text-text' : 'text-muted'}`} aria-current={current ? 'page' : undefined} data-tooltip={tip !== label ? tip : undefined} data-nav={key} onClick={onClick}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <Kbd shortcut={shortcut} tone="plain" />}
    </button>
  );
  return (
    <nav aria-label="Views" className="mx-3 mb-2 grid gap-px" data-nav-text>
      <button type="button" className={`${item} text-text`} aria-label={newSessionLabel} data-new-session onClick={onNewSession}>
        <span className="min-w-0 flex-1 truncate">New session</span>
        <Kbd shortcut="session.new" tone="plain" />
      </button>
      {entry('search', 'Search', 'Search all conversations', false, () => useOverlay.getState().show('search'), 'search')}
      {entry('upcoming', 'Upcoming', `Upcoming · ${summary.hint?.text ?? (summary.count > 0 ? `${summary.count} planned` : 'nothing planned')}`, view === 'upcoming', () => (sessions(), openUpcoming()))}
      {entry('activity', 'Activity', today > 0 ? `Activity · ${today} today` : 'Activity', view === 'activity', () => (sessions(), openActivity()))}
      {browser && entry('browser', 'Browser', tabs > 0 ? `Browser · ${tabs} ${tabs === 1 ? 'tab' : 'tabs'}` : 'Browser', view === 'browser', openBrowserView)}
    </nav>
  );
}
