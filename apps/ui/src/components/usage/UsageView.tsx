import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Gauge, RefreshCw } from 'lucide-react';
import type { UsagePeriod } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { thisComputerName } from '../../lib/platform.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { closeUsage, useUsageView, type UsageComputers, type UsageTab } from '../../state/usageViewStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { fetchUsage, useUsageFor } from '../UsageBand.tsx';
import { LimitsTab } from './LimitsTab.tsx';
import { TokensTab } from './TokensTab.tsx';
import { PERIOD_LABEL, PERIODS } from './usageModel.ts';

const TABS: Array<{ id: UsageTab; label: string }> = [
  { id: 'limits', label: 'Limits' },
  { id: 'tokens', label: 'Tokens' },
];

/** "1m ago", "just now". */
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** A field or a control that takes keys itself (the breakdown's filter) keeps number keys and Esc. */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.closest('input, textarea, [contenteditable="true"]') !== null);
/** In the window's terminal, Esc belongs to the program there (or restores the panel), not to Back. */
const inTerminal = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('[data-terminal-panel]') !== null;
/** A menu, dialog or popover is open: it takes Esc first. */
const overlayOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-popover]') !== null;

/**
 * Where a profile's plan went: Limits (what's left of each window and when it comes back, % over time, and which
 * sessions used the current window) and Tokens (where the tokens went per session, project, model and day). A main
 * view like Home; Esc and Back return to where it was opened from.
 */
export function UsageView() {
  const profileId = useUsageView((s) => s.profileId) ?? useProfiles.getState().defaultId;
  const tab = useUsageView((s) => s.tab);
  const period = useUsageView((s) => s.period);
  const computers = useUsageView((s) => s.computers);
  const { setTab, setPeriod, setProfile, setComputers } = useUsageView.getState();
  // Other computers count only while some are paired; then the choice shows.
  const paired = useComputers((s) => s.status?.computers.length ?? 0) > 0;
  const profiles = useProfiles((s) => s.profiles);
  const profile = profiles.find((p) => p.id === profileId);
  const entry = useUsageFor(profileId);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const menuButton = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<UsageTab, HTMLButtonElement>());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The view's keys: ⌘1 and ⌘2 for the tabs, 1 to 4 for the periods, Esc for Back.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matches(event, 'usage.limits') || matches(event, 'usage.tokens')) {
        event.preventDefault();
        useUsageView.getState().setTab(matches(event, 'usage.limits') ? 'limits' : 'tokens');
      } else if (matches(event, 'usage.period') && !typing(event.target) && !overlayOpen()) {
        event.preventDefault();
        useUsageView.getState().setPeriod(PERIODS[Number(event.key) - 1]!);
      } else if (matches(event, 'usage.back') && !overlayOpen() && !inTerminal(event.target)) {
        // Esc in the filter clears it first (the field handles that and marks the key handled).
        event.preventDefault();
        closeUsage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refresh = () => {
    if (!client || refreshing) return;
    setRefreshing(true);
    void fetchUsage(client, profileId, true).finally(() => setRefreshing(false));
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'limits' ? 'tokens' : 'limits';
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const entries: MenuEntry[] = [
    ...profiles.map(
      (p): MenuEntry => ({
        label: p.name,
        detail: [p.account?.email, p.configDir].filter(Boolean).join(' · '),
        icon: <ProfileDot color={p.color} size={8} />,
        checked: p.id === profileId,
        data: { 'data-usage-profile-item': p.id },
        onSelect: () => setProfile(p.id),
      }),
    ),
    { note: 'Each profile has its own login and limits. Profiles that share a folder are counted once.' },
  ];

  const fetchedAt = entry?.usage?.fetchedAt ?? null;
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-usage-view data-usage-profile={profileId}>
      <header className="drag shrink-0 border-b border-border px-6 pt-2.5">
        <div className="flex min-h-9 items-center gap-2.5">
          <SidebarToggle />
          <Gauge size={18} className="shrink-0 text-muted" aria-hidden />
          <h1 className="text-hero leading-tight font-semibold">Usage</h1>
          <button
            ref={menuButton}
            type="button"
            className="no-drag ml-1 flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-ui hover:bg-border/45"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            aria-label={`Profile: ${profile?.name ?? 'Claude'}. Change profile`}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: box.left, y: box.bottom + 4 });
            }}
            data-usage-profile-menu
          >
            {profile && <ProfileDot color={profile.color} size={8} />}
            {/* The name stays whole; the email gives way first. */}
            <span className="max-w-40 shrink-0 truncate">{profile?.name ?? 'Claude'}</span>
            {profile?.account?.email && <span className="min-w-0 truncate text-faint">{profile.account.email}</span>}
            <ChevronDown size={13} className="shrink-0 text-muted" aria-hidden />
          </button>
          <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
            {fetchedAt && (
              <span className="text-meta text-muted @max-[700px]:hidden" data-usage-updated>
                Plan usage updated {ago(fetchedAt, now)}
              </span>
            )}
            <Button
              variant="quiet"
              size="md"
              iconOnly
              icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden />}
              aria-label="Refresh plan usage"
              disabled={!client || refreshing}
              onClick={refresh}
              data-usage-refresh
            />
            <Button variant="quiet" size="md" shortcut="usage.back" onClick={closeUsage} data-usage-back>
              Back
            </Button>
          </div>
        </div>
        <div className="no-drag mt-2 flex items-end gap-3">
          <div role="tablist" aria-label="Usage" className="-mb-px flex gap-1" onKeyDown={onTabKey}>
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                ref={(el) => {
                  if (el) tabRefs.current.set(id, el);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`usage-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="usage-tab-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                className={`flex h-9 items-center border-b-2 px-3 text-ui ${tab === id ? 'border-accent-ink font-semibold text-text' : 'border-transparent text-muted hover:text-text'}`}
                data-usage-tab={id}
              >
                {label}
              </button>
            ))}
          </div>
          {paired && (
            <SegmentedControl<UsageComputers>
              mode="radio"
              label="Computers"
              className="mb-1.5 ml-auto"
              value={computers}
              onChange={setComputers}
              segments={[
                { value: 'this', label: thisComputerName(), data: { 'data-usage-computers-choice': 'this' } },
                { value: 'all', label: 'All computers', tooltip: 'Add the tokens this account used on your paired computers', data: { 'data-usage-computers-choice': 'all' } },
              ]}
            />
          )}
          <SegmentedControl<UsagePeriod>
            mode="radio"
            label="Period"
            className={`mb-1.5 ${paired ? '' : 'ml-auto'}`}
            value={period}
            onChange={setPeriod}
            segments={PERIODS.map((value, i) => ({ value, label: PERIOD_LABEL[value], kbd: String(i + 1), data: { 'data-usage-period': value } }))}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div role="tabpanel" id="usage-tab-panel" aria-labelledby={`usage-tab-${tab}`} className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-4 px-6 py-5">
          {tab === 'limits' ? <LimitsTab profileId={profileId} period={period} /> : <TokensTab profileId={profileId} profileName={profile?.name ?? 'Claude'} period={period} />}
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} width={320} entries={entries} onClose={() => setMenu(null)} anchor={menuButton} label="Profiles" />}
    </div>
  );
}
