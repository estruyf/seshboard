import { useVirtualizer } from '@tanstack/react-virtual';
import { House, ListEnd, Pin, Plus, Search, Settings } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { basename, shortAge } from '../../lib/format.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { sidebarGroups, statusLine, waitingDetail, type WaitingRequest } from '../../state/sidebarOrder.ts';
import { GROUP_LABEL, inScope, rowStatus, type RowStatus, type SessionGroup } from '../../state/sidebarRows.ts';
import { useSidebarSections } from '../../state/sidebarSectionsStore.ts';
import { isSectionKey, type SectionKey } from '../../state/sidebarSections.ts';
import { useQueue } from '../../state/useQueue.ts';
import { FocusCounter } from '../focus/FocusCounter.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { newSessionDraftTooltip, PenBadge } from '../drafts/PenBadge.tsx';
import { openDraft, useNewSessionDraft, useUnsent } from '../drafts/useUnsent.ts';
import { STATUS_LABEL } from './rowLabel.ts';
import { useSessionMenu } from './useSessionMenu.tsx';
import { localizeKeys, matches, modKey } from '../../lib/shortcuts.ts';

/**
 * One row of the rail: a session, the thin line between two groups, a closed section as one chip (its count, and a
 * dot when something in it is unread), or the queue's button (its ready count in green).
 */
type RailItem =
  | { kind: 'session'; data: SessionRowData }
  | { kind: 'divider'; key: string }
  | { kind: 'chip'; section: SectionKey; group: SessionGroup; count: number; unread: number }
  | { kind: 'queue'; count: number; ready: number };

const ROW_HEIGHT = 44;
const DIVIDER_HEIGHT = 13;
const CHIP_HEIGHT = 32;
const QUEUE_HEIGHT = 58;
const itemHeight = (item: RailItem) => (item.kind === 'session' ? ROW_HEIGHT : item.kind === 'chip' ? CHIP_HEIGHT : item.kind === 'queue' ? QUEUE_HEIGHT : DIVIDER_HEIGHT);

/** A closed section in the rail: its first letter (a pin for Pinned) and count. A click opens the sidebar there. */
function SectionChip({ item }: { item: Extract<RailItem, { kind: 'chip' }> }) {
  const label = GROUP_LABEL[item.group];
  const what = `${label}, ${item.count} ${item.count === 1 ? 'session' : 'sessions'}${item.unread ? `, ${item.unread} unread` : ''}`;
  return (
    <button
      type="button"
      onClick={() => useSidebarSections.getState().showSection(item.section)}
      aria-label={`${what}. Open the sidebar there`}
      data-tooltip={what}
      data-tooltip-placement="right"
      data-tooltip-title={label}
      data-tooltip-meta={`${item.count} ${item.count === 1 ? 'session' : 'sessions'}`}
      data-tooltip-status={item.unread ? `${item.unread} unread` : undefined}
      data-tooltip-tone={item.unread ? 'unread' : 'faint'}
      data-tooltip-hint="Click to open the sidebar here"
      data-rail-section={item.section}
      className="relative mx-auto flex h-6 min-w-9 items-center justify-center gap-1 rounded-full bg-border/50 px-2 text-meta font-semibold text-muted tabular-nums hover:bg-border hover:text-text"
    >
      {item.group === 'pinned' ? <Pin size={10} aria-hidden /> : <span aria-hidden>{label[0]}</span>}
      <span aria-hidden>{item.count}</span>
      {item.unread > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-unread ring-2 ring-sidebar" />}
    </button>
  );
}

/** The queue in the rail: one button with how many are ready, and how many are queued under it. */
function QueueButton({ item }: { item: Extract<RailItem, { kind: 'queue' }> }) {
  const what = `Queue, ${item.count} queued${item.ready ? `, ${item.ready} ready` : ''}`;
  return (
    <button
      type="button"
      onClick={() => useSidebarSections.getState().showSection('queue')}
      aria-label={`${what}. Open the sidebar on the queue`}
      data-tooltip={what}
      data-tooltip-placement="right"
      data-tooltip-title="Queue"
      data-tooltip-meta={`${item.count} queued`}
      data-tooltip-status={item.ready ? `${item.ready} ready to start` : undefined}
      data-tooltip-tone={item.ready ? 'ok' : 'faint'}
      data-tooltip-hint="Click to open the sidebar on the queue"
      data-rail-queue
      className="mx-auto flex flex-col items-center gap-0.5 rounded-lg px-1.5 pt-1 text-muted hover:text-text"
    >
      <span className={`relative flex size-9 items-center justify-center rounded-lg ${item.ready ? 'bg-ok/15 text-ok' : 'bg-border/50'}`}>
        <ListEnd size={16} aria-hidden />
        {item.ready > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ok px-1 text-[10px] leading-none font-semibold text-bg tabular-nums ring-2 ring-sidebar" data-rail-queue-ready={item.ready}>
            {item.ready}
          </span>
        )}
      </span>
      <span className="text-meta tabular-nums">{item.count} queued</span>
    </button>
  );
}

/** The 3px rail at a row's left edge, as in the open sidebar: only the states that ask for a look get one. */
const RAIL_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'bg-warn', running: 'bg-accent-ink', unread: 'bg-unread' };
/** The dot at the icon's corner: needs you or unread, the two that wait for you to look. */
const CORNER_DOT: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'bg-warn', unread: 'bg-unread' };

/** Re-renders relative ages once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const RailRow = memo(function RailRow({
  data,
  selected,
  beside,
  tabbable,
  now,
  request,
  draft,
  onClick,
  onMenu,
  onMiddleClick,
}: {
  data: SessionRowData;
  selected: boolean;
  /** Shown in the other (inactive) pane. */
  beside: boolean;
  tabbable: boolean;
  now: number;
  /** The oldest permission or question it waits on, for the tooltip's status line. */
  request: WaitingRequest | null;
  /** The start of an unsent message typed here, or null. */
  draft: string | null;
  onClick(event: MouseEvent, data: SessionRowData): void;
  onMenu(at: { x: number; y: number }, data: SessionRowData): void;
  onMiddleClick(data: SessionRowData): void;
}) {
  const project = useProjects((s) => s.projects.get(data.projectRoot));
  const projectName = project?.name ?? basename(data.projectRoot);
  const status = rowStatus(data);
  // With more than one Claude profile the rail is the profile's colour on every row, as in the open sidebar.
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(data.profileId);
  const profileRail = multipleProfiles && profile ? PROFILE_DOT[profile.color] : null;
  const railTone = profileRail ?? (status && RAIL_TONE[status]);
  const dot = status && CORNER_DOT[status];
  const line = statusLine(status, status === 'needs-you' ? waitingDetail(request) : null);
  const meta = [projectName, data.branch, shortAge(data.updatedAt, now)].filter(Boolean).join(' · ');
  const hint = localizeKeys('Click to open · ⌥-click to open beside');
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.right - 4, y: rect.top + 8 };
  };
  return (
    <button
      type="button"
      data-sidebar-rail-row={data.id}
      data-session-status={status ?? undefined}
      tabIndex={tabbable ? 0 : -1}
      aria-current={selected ? 'true' : undefined}
      aria-label={[data.title || 'Untitled session', projectName, status ? STATUS_LABEL[status].toLowerCase() : null, beside ? 'open in the other pane' : null, draft !== null ? 'unsent message' : null].filter(Boolean).join(', ')}
      data-has-draft={draft !== null || undefined}
      data-tooltip={[data.title, meta, line?.text ?? (draft !== null ? `Draft: ${draft}` : null), hint].filter(Boolean).join('\n')}
      data-tooltip-placement="right"
      data-tooltip-title={data.title || 'Untitled session'}
      data-tooltip-meta={meta}
      data-tooltip-status={line?.text ?? (draft !== null ? `Draft: ${draft}` : undefined)}
      data-tooltip-tone={line?.tone ?? 'faint'}
      data-tooltip-hint={hint}
      onClick={(e) => onClick(e, data)}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onMiddleClick(data);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX === 0 && e.clientY === 0 ? menuAt(e.currentTarget) : { x: e.clientX, y: e.clientY }, data);
      }}
      onKeyDown={(e) => {
        if (isContextMenuKey(e)) {
          e.preventDefault();
          onMenu(menuAt(e.currentTarget), data);
        }
      }}
      className={`relative mx-auto flex h-10 w-11 items-center justify-center rounded-lg ${selected ? 'bg-selected' : beside ? 'bg-border/45 ring-1 ring-inset ring-border' : 'hover:bg-border/45'}`}
    >
      {railTone && <span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-full ${railTone}`} data-profile-badge={profileRail && profile ? profile.id : undefined} />}
      <ProjectIcon project={project} root={data.projectRoot} size={26} />
      {draft !== null && <PenBadge size={14} className="absolute bottom-0.5 left-0.5" data-rail-pen />}
      {dot && (
        <span aria-hidden className={`absolute top-1 right-1 size-[9px] rounded-full ring-2 ring-sidebar ${dot} ${status === 'needs-you' ? 'animate-pulse' : ''}`} data-rail-dot={status} />
      )}
    </button>
  );
});

/**
 * The minimal sidebar: an 80px rail with New session, Search and Home at the top, one icon per session in
 * the open sidebar's groups and order (a thin line between groups, archived ones left out), and the focus
 * counter and Settings at the bottom. Picking several sessions isn't possible here: ⌘- or ⇧-click opens
 * the sidebar first.
 */
export function SidebarRail() {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const selectedId = useSessions((s) => s.selectedId);
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const view = useSessions((s) => s.view);
  const listView = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.mainId === null);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const now = useNow();
  const unsent = useUnsent();
  const draftPreviews = useMemo(() => new Map(unsent.flatMap((e) => (e.item.kind === 'session' ? [[e.item.sessionId, e.item.preview] as const] : []))), [unsent]);
  const newDraft = useNewSessionDraft();

  const all = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const groups = useMemo(() => sidebarGroups(all, { now }), [all, now]);
  const sectionsOpen = useSidebarSections((s) => s.open);
  const queue = useQueue(all);
  const items = useMemo<RailItem[]>(() => {
    // Blocks in the open sidebar's order (the queue under Working), a thin line between them.
    const blocks: { key: string; items: RailItem[] }[] = [];
    const queueBlock = queue.entries.length ? [{ key: 'queue', items: [{ kind: 'queue' as const, count: queue.entries.length, ready: queue.readyCount }] }] : [];
    let queued = false;
    for (const { group, rows } of groups) {
      if (!queued && group !== 'needs-you' && group !== 'working') {
        blocks.push(...queueBlock);
        queued = true;
      }
      if (isSectionKey(group) && !sectionsOpen[group]) {
        // A closed section is one chip; the open session stays beside it, as in the sidebar.
        const unread = rows.filter((row) => rowStatus(row) === 'unread').length;
        const kept = rows.filter((row) => row.id === selectedId).map((data) => ({ kind: 'session' as const, data }));
        blocks.push({ key: group, items: [{ kind: 'chip', section: group, group, count: rows.length, unread }, ...kept] });
      } else blocks.push({ key: group, items: rows.map((data) => ({ kind: 'session' as const, data })) });
      if (group === 'working') {
        blocks.push(...queueBlock);
        queued = true;
      }
    }
    if (!queued) blocks.push(...queueBlock);
    return blocks.flatMap((block, i) => [...(i > 0 ? [{ kind: 'divider' as const, key: `divider-${block.key}` }] : []), ...block.items]);
  }, [groups, sectionsOpen, queue.entries.length, queue.readyCount, selectedId]);
  const order = useMemo(() => items.flatMap((item) => (item.kind === 'session' ? [item.data.id] : [])), [items]);
  // The oldest open request of each waiting session: what its tooltip says it waits for.
  const requests = useMemo(() => {
    const map = new Map<string, WaitingRequest>();
    for (const request of permissions.values()) {
      const seen = map.get(request.sessionId);
      if (!seen || request.createdAt < seen.createdAt) map.set(request.sessionId, request);
    }
    return map;
  }, [permissions]);
  const menus = useSessionMenu(order);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => itemHeight(items[i]!),
    getItemKey: useCallback((i: number) => {
      const item = items[i]!;
      return item.kind === 'session' ? item.data.id : item.kind === 'chip' ? `chip-${item.section}` : item.kind === 'queue' ? 'queue' : item.key;
    }, [items]),
    overscan: 10,
  });
  useEffect(() => virtualizer.measure(), [items, virtualizer]);
  const virtualItems = virtualizer.getVirtualItems();

  // One Tab stop for the list (roving tabindex): the selected row while it's rendered, else the first rendered one.
  const renderedIds = virtualItems.flatMap((v) => {
    const item = items[v.index];
    return item?.kind === 'session' ? [item.data.id] : [];
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStopId =
    focusedId && renderedIds.includes(focusedId) ? focusedId : listView === 'session' && selectedId && renderedIds.includes(selectedId) ? selectedId : (renderedIds[0] ?? null);

  const focusRow = (id: string) => {
    setFocusedId(id);
    virtualizer.scrollToIndex(
      items.findIndex((item) => item.kind === 'session' && item.data.id === id),
      { align: 'auto' },
    );
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-sidebar-rail-row="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  };

  // ↑/↓ move between rows; ↩ (the button's own) opens the focused one.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matches(event.nativeEvent, 'sidebar.move') && !matches(event.nativeEvent, 'sidebar.select')) return;
    event.preventDefault();
    if (order.length === 0) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-sidebar-rail-row]')?.dataset.sidebarRailRow ?? tabStopId;
    const index = current ? order.indexOf(current) : -1;
    const next = order[index === -1 ? 0 : Math.min(order.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]!;
    focusRow(next);
  };

  const rowClick = useCallback((event: MouseEvent, data: SessionRowData) => {
    // Picking several sessions happens in the open sidebar.
    if (modKey(event) || event.shiftKey) return useSidebar.getState().setState('open');
    if (event.altKey) useSessions.getState().openBeside(data.id);
    else useSessions.getState().select(data.id);
  }, []);

  return (
    <nav aria-label="Sidebar" className="flex h-full w-20 shrink-0 flex-col border-r border-border bg-sidebar" data-sidebar-rail>
      {/* The traffic lights sit in this strip, which doubles as a window drag handle. */}
      <div className="drag h-13 shrink-0" />
      <div className="flex shrink-0 flex-col items-center gap-1 pb-2">
        <span className="no-drag relative flex">
          <Button
            variant="primary"
            size="lg"
            iconOnly
            icon={<Plus size={17} strokeWidth={2.4} aria-hidden />}
            aria-label={newDraft ? newSessionDraftTooltip(newDraft.name) : 'New session'}
            shortcut="session.new"
            data-tooltip-placement="right"
            data-new-session
            onClick={() => (newDraft ? openDraft(newDraft.item) : useSessions.getState().openNewSession())}
            className={`w-9! rounded-lg! ${view === 'new' ? 'ring-2 ring-accent/40 ring-offset-1 ring-offset-sidebar' : ''}`}
          />
          {newDraft && <PenBadge className="absolute -top-1.5 -right-1.5" data-new-session-draft={newDraft.item.root ?? ''} />}
        </span>
        <Button
          variant="quiet"
          size="lg"
          iconOnly
          icon={<Search size={15} aria-hidden />}
          aria-label="Go to a session"
          shortcut="palette.goto"
          data-tooltip-placement="right"
          data-rail-search
          onClick={() => useOverlay.getState().togglePalette('goto')}
          className="no-drag w-9! rounded-lg!"
        />
        <Button
          variant="quiet"
          size="lg"
          iconOnly
          icon={<House size={15} aria-hidden />}
          aria-label="Home"
          shortcut="home"
          selected={atHome}
          aria-current={atHome ? 'page' : undefined}
          data-tooltip-placement="right"
          data-go-home
          onClick={() => useSessions.getState().goHome()}
          className="no-drag w-9! rounded-lg!"
        />
      </div>
      <div aria-hidden className="mx-3 h-px shrink-0 bg-border" />

      <div ref={scrollRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1.5 [scrollbar-width:none]" data-session-list>
        <div role="list" aria-label="Sessions" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map((v) => {
            const item = items[v.index]!;
            return (
              <div
                key={v.key}
                role={item.kind === 'divider' ? 'presentation' : 'listitem'}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: v.size, transform: `translateY(${v.start}px)` }}
                className={item.kind === 'divider' ? 'flex items-center px-3' : undefined}
              >
                {item.kind === 'divider' ? (
                  <span aria-hidden className="h-px w-full bg-border" data-rail-divider />
                ) : item.kind === 'chip' ? (
                  <SectionChip item={item} />
                ) : item.kind === 'queue' ? (
                  <QueueButton item={item} />
                ) : (
                  <RailRow
                    data={item.data}
                    selected={listView === 'session' && item.data.id === selectedId}
                    beside={listView === 'session' && splitId !== null && item.data.id !== selectedId && (item.data.id === mainId || item.data.id === splitId)}
                    tabbable={item.data.id === tabStopId}
                    now={now}
                    request={requests.get(item.data.id) ?? null}
                    draft={draftPreviews.get(item.data.id) ?? null}
                    onClick={rowClick}
                    onMenu={menus.openSessionMenu}
                    onMiddleClick={menus.middleClick}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex shrink-0 flex-col items-center gap-1.5 border-t border-border py-2">
        <FocusCounter compact />
        <Button
          variant="quiet"
          iconOnly
          icon={<Settings size={15} aria-hidden />}
          aria-label="Settings"
          shortcut="settings"
          selected={view === 'settings'}
          aria-current={view === 'settings' ? 'page' : undefined}
          data-tooltip-placement="right"
          data-open-settings
          onClick={() => (view === 'settings' ? useSessions.getState().closeSettings() : useSessions.getState().openSettings())}
        />
      </footer>
      {menus.overlays}
    </nav>
  );
}
