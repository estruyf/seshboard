import { currentPlatform } from '../../lib/platform.ts';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Archive, ArchiveRestore, Check, FolderCog, GitBranch, House, ListEnd, PencilLine, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react';
import type { SidebarStyle } from '@switchboard/protocol/bridge';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { basename, shortAge } from '../../lib/format.ts';
import { newSessionDraftTooltip, PenBadge } from '../drafts/PenBadge.tsx';
import { openUnsentList } from '../drafts/UnsentList.tsx';
import { openDraft, useNewSessionDraft, useUnsent } from '../drafts/useUnsent.ts';
import { Pill } from '../ui/Pill.tsx';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { queueInList } from '../../state/queue.ts';
import { useQueue } from '../../state/useQueue.ts';
import { useSidebarSections } from '../../state/sidebarSectionsStore.ts';
import { closedSections, isSectionKey, type SectionKey } from '../../state/sidebarSections.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { archivedPlacement, archivedRevealTop, buildListRows, buildSessionList, GROUP_LABEL, headerSummary, inScope, isActive, rowStatus, sessionsByHeader, waitingLabel, type HeaderKey, type RowStatus, type SidebarListRow } from '../../state/sidebarRows.ts';
import { NO_PICKS, pickGroup, rangePick, stepPick, togglePick, visiblePicks, type Picks } from '../../state/sessionPicks.ts';
import { FocusCounter } from '../focus/FocusCounter.tsx';
import type { MenuEntry } from '../Menu.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { inWorktree } from '../worktree/branchMenu.ts';
import { ProjectFilter } from './ProjectMenu.tsx';
import { sessionRowLabel } from './rowLabel.ts';
import { StatusIcon } from './StatusIcon.tsx';
import { ARCHIVE, useSessionMenu, type FlagChange } from './useSessionMenu.tsx';
import { formatKeys, keysFor, matches, modKey } from '../../lib/shortcuts.ts';
import { useQueueMenu } from '../queue/queueMenu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { QueueRow } from './QueueRow.tsx';
import { reducedMotion, tween } from './archivedMotion.ts';

const SESSION_ROW_HEIGHT: Record<SidebarStyle, number> = { large: 52, standard: 48, compact: 34 };
const ARCHIVED_HEADER_HEIGHT = 34;
const GROUP_HEADER_HEIGHT = 34;
/** The faint "+N hidden" line under a closed section's kept row. */
const HIDDEN_ROW_HEIGHT = 18;
/** The space below each session button inside its row: picked rows fill it, so a run of picks reads as one block. */
const SESSION_ROW_GAP: Record<SidebarStyle, number> = { large: 4, standard: 4, compact: 2 };

const rowHeight = (row: SidebarListRow, style: SidebarStyle) =>
  row.kind === 'session'
    ? SESSION_ROW_HEIGHT[style]
    : row.kind === 'queue'
      ? SESSION_ROW_HEIGHT[style]
      : row.kind === 'hidden'
        ? HIDDEN_ROW_HEIGHT
        : row.kind === 'group' || row.kind === 'queue-header'
          ? GROUP_HEADER_HEIGHT - (row.first ? 6 : 0)
          : ARCHIVED_HEADER_HEIGHT;

/** The key a header row's section is stored under, or null for Needs you (it never closes). */
const sectionOfHeader = (row: SidebarListRow): SectionKey | null => (row.kind === 'queue-header' ? 'queue' : row.kind === 'group' && isSectionKey(row.group) ? row.group : null);

/** The 3px rail at a row's left edge: only the states that ask for a look get one. */
const RAIL_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'bg-warn', running: 'bg-accent-ink', unread: 'bg-unread' };
const AGE_TONE: Partial<Record<Exclude<RowStatus, null>, string>> = { 'needs-you': 'text-warn', running: 'text-accent-ink', unread: 'text-unread' };

/** The selection sheet's actions: three to a row in the sidebar's width, so they keep less padding than a button usually has. */
const pickButton = 'min-w-0 px-1.5!';

/**
 * A section header in the list, with its count. Needs you and Working take their status colour. Every section but
 * Needs you can close: the chevron sits in the gutter, pointing down while open, a closed header
 * says what matters inside ("2 unread"), ⌥-click opens or closes them all, and ← → close and open the focused one.
 */
function GroupHeader({ row, selectAll, onToggle }: { row: Extract<SidebarListRow, { kind: 'group' | 'queue-header' }>; selectAll: ReactNode; onToggle(section: SectionKey, all: boolean): void }) {
  const section = sectionOfHeader(row);
  const status = row.kind === 'group' && (row.group === 'needs-you' || row.group === 'working') ? row.group : null;
  const summary = headerSummary(row);
  const queue = row.kind === 'queue-header';
  const label = queue ? 'Queue' : GROUP_LABEL[row.group];
  return (
    // The row is taller than the label: it sits at the bottom, just above its sessions.
    <div className={`flex h-full items-end px-2.5 ${row.first ? 'pb-1' : 'pb-1.5'}`} {...(queue ? { 'data-queue-header': true } : {})}>
      <SectionHeader
        tone={status ?? 'neutral'}
        count={row.count}
        toggle={
          section
            ? {
                expanded: row.open,
                leading: true,
                onToggle: (event) => onToggle(section, event.altKey),
                tooltip: queue ? 'Prompts waiting to start. Click one to check it in New session; Start runs it now.' : undefined,
                data: { 'data-section-toggle': section, 'data-open': row.open },
              }
            : undefined
        }
        action={
          (summary || selectAll) && (
            <>
              {summary && (
                <span className={`ml-auto text-meta font-medium tracking-normal normal-case ${summary.tone === 'ok' ? 'text-ok' : 'text-unread'}`} data-section-summary={section ?? undefined}>
                  {summary.text}
                </span>
              )}
              {selectAll}
            </>
          )
        }
        className="h-[22px] flex-1"
        data-session-group={queue ? undefined : row.group}
      >
        {queue && <ListEnd size={12} className="shrink-0" aria-hidden />}
        {label}
      </SectionHeader>
    </div>
  );
}

/** The Archived header, docked under the list while closed and in the list while open: the same toggle in both places. */
function ArchivedHeader({ count, open, onToggle, action }: { count: number; open: boolean; onToggle(): void; action?: ReactNode }) {
  return (
    <SectionHeader
      count={count}
      toggle={{
        expanded: open,
        onToggle,
        leading: true,
        tooltip: 'Quiet for 48 hours, or archived by you. They come back when there is something new.',
        data: { 'data-archived-toggle': true, 'data-open': open },
      }}
      action={action}
      className="h-[22px] flex-1"
    >
      Archived
    </SectionHeader>
  );
}

/** "Select all" on a header while picking: picks every session under it, or takes them all away again. */
function SelectAllButton({ group, all, onClick }: { group: HeaderKey; all: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      data-select-group={group}
      onClick={onClick}
      className="ml-auto self-center rounded px-1 text-ui font-medium tracking-normal text-link normal-case hover:underline"
    >
      {all ? 'Deselect all' : 'Select all'}
    </button>
  );
}

/** Where a project icon was, while picking: a round checkbox on every row, like Mail. A click toggles the row. */
function PickBox({ on, size, onToggle }: { on: boolean; size: number; onToggle(): void }) {
  return (
    <span
      data-pick-box={on}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full ${on ? 'bg-accent text-on-accent' : 'border-[1.5px] border-faint/70 hover:border-text'}`}
      aria-hidden
    >
      {on && <Check size={Math.round(size * 0.62)} strokeWidth={3} />}
    </span>
  );
}

/** Re-renders relative ages (and the 48 h cut-off) once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export const SessionRow = memo(function SessionRow({
  data,
  selected,
  beside = false,
  archived,
  picked,
  picking,
  now,
  tabbable,
  waitingFor,
  draft,
  onClick,
  onTogglePick,
  onMenu,
  onMiddleClick,
}: {
  data: SessionRowData;
  selected: boolean;
  /** Shown in the other (inactive) pane. */
  beside?: boolean;
  /** Listed under Archived. */
  archived: boolean;
  /** One of several sessions picked with ⌘- or ⇧-click. */
  picked: boolean;
  /** Several sessions are picked: every row shows a checkbox instead of its project icon. */
  picking: boolean;
  now: number;
  /** The list's one Tab stop (roving tabindex): ↑ ↓ move between rows from there. */
  tabbable: boolean;
  /** For a session waiting for you: what it asks for ("Permission: Bash", "Question"). */
  waitingFor: string | null;
  /** The start of an unsent message typed here (one that counts), or null. */
  draft: string | null;
  onClick(event: MouseEvent, data: SessionRowData): void;
  onTogglePick(id: string): void;
  onMenu(at: { x: number; y: number }, data: SessionRowData): void;
  onMiddleClick(data: SessionRowData): void;
}) {
  const project = useProjects((s) => s.projects.get(data.projectRoot));
  const style = usePreferences((s) => s.prefs.sidebarStyle);
  // With a project filter on, every row is in that project: the name would only repeat.
  const filtered = useProjects((s) => s.filter !== null);
  const status = rowStatus(data);
  // A running session on its project's checkout: the branch the header read from git, once it has.
  const liveCwd = data.live?.cwd && !data.isWorktree && !inWorktree(data.live.cwd) ? data.live.cwd : null;
  const liveBranch = useCheckoutBranches((s) => (liveCwd && s.byCwd.has(liveCwd) ? (s.byCwd.get(liveCwd) ?? 'detached') : null));
  const branch = liveBranch ?? data.branch;
  const emphasised = status === 'needs-you' || status === 'running' || status === 'unread';
  const ageTone = (status && AGE_TONE[status]) ?? 'text-faint';
  const projectName = project?.name ?? basename(data.projectRoot);
  const titleTone = emphasised || selected ? 'font-semibold text-text' : archived ? 'text-muted' : 'text-text/85';
  const age = <span className={`shrink-0 text-meta tabular-nums ${ageTone}`}>{shortAge(data.updatedAt, now)}</span>;
  // The line at the row's left edge. With more than one Claude profile it is the profile's colour, on
  // every row, so you see whose account a session uses at a glance; the status then shows in the age's
  // colour, the bold title and the group. With one profile it is the status (needs you, working, unread).
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(data.profileId);
  const statusRail = status && RAIL_TONE[status];
  const profileRail = multipleProfiles && profile ? PROFILE_DOT[profile.color] : null;
  const railTone = profileRail ?? statusRail;
  const rail = railTone && (
    <span
      className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full ${railTone} ${archived && !selected ? 'opacity-50' : ''}`}
      data-profile-badge={profileRail && profile ? profile.id : undefined}
      aria-hidden
    />
  );
  const pin = data.pinned && <Pin size={11} className="shrink-0 text-faint" aria-hidden />;
  // An unsent message: a pen in the same corner, never in a status colour.
  const pen = draft !== null && <PencilLine size={11} className="shrink-0 text-faint" aria-hidden data-row-pen />;
  const icon = (size: number) =>
    picking ? (
      <PickBox on={picked} size={size} onToggle={() => onTogglePick(data.id)} />
    ) : (
      <span className={`flex shrink-0 ${archived && !selected ? 'opacity-60' : ''}`}>
        <ProjectIcon project={project} root={data.projectRoot} size={size} />
      </span>
    );
  // Below the row's corner, for menus opened from the keyboard (or VoiceOver, which sends a contextmenu at 0,0).
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };
  const common = {
    type: 'button' as const,
    'data-session-id': data.id,
    'data-in-app': data.inApp,
    tabIndex: tabbable ? 0 : -1,
    'aria-current': selected ? ('true' as const) : undefined,
    // The visible lines lean on icons, colour and short ages; this says the same in words.
    // Indexed sessions have a transcript, so they can be pinned and archived.
    'data-indexed': data.summary !== null,
    'data-archived': archived || undefined,
    'data-picked': picked || undefined,
    'data-has-draft': draft !== null || undefined,
    'aria-label': sessionRowLabel({ title: data.title, project: projectName, status, pinned: data.pinned, archived, picked, beside, draft: draft !== null, updatedAt: data.updatedAt, now }),
    onClick: (e: MouseEvent) => onClick(e, data),
    // A middle-click archives a finished session, as closing a tab would.
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      onMiddleClick(data);
    },
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      onMenu(e.clientX === 0 && e.clientY === 0 ? menuAt(e.currentTarget) : { x: e.clientX, y: e.clientY }, data);
    },
    // ⇧F10 (and the menu key) open the same menu as a right-click. While picking, Space ticks the row's checkbox.
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        onMenu(menuAt(e.currentTarget), data);
      } else if (e.key === ' ' && picking) {
        e.preventDefault();
        onTogglePick(data.id);
      }
    },
    'data-tooltip': [data.title, style === 'compact' ? projectName : null, style === 'compact' ? waitingFor : null, multipleProfiles && profile ? `Profile: ${profile.name}` : null, data.summary?.cwd].filter(Boolean).join('\n'),
  };
  // Selection is a neutral fill (a yellow tint vanishes on the light sidebar). Picked rows sit on a
  // tinted block the list draws behind them, so they need no fill of their own.
  const surface = picked
    ? ''
    : selected
      ? 'bg-selected'
      : beside
        ? 'bg-border/45 ring-1 ring-inset ring-border'
        : 'hover:bg-border/45';

  if (style === 'compact') {
    return (
      <button {...common} className={`relative flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-meta ${surface}`}>
        {rail}
        {icon(16)}
        <span className={`min-w-0 flex-1 truncate text-body ${titleTone}`}>{data.title}</span>
        {pin}
        {pen}
        {status ? <StatusIcon status={status} /> : age}
      </button>
    );
  }

  // Two lines: the title with its age, then what it waits for (needs you) or where it runs.
  const place = [branch, filtered ? null : projectName].filter(Boolean);
  const lines = (
    <span className="grid min-w-0 flex-1 gap-px">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-body leading-5 ${titleTone}`}>{data.title}</span>
        {/* The pin sits with the age in the title's corner, as in the compact row. */}
        <span className="flex shrink-0 items-center gap-1">
          {pin}
          {pen}
          {age}
        </span>
      </span>
      <span className="flex h-4 min-w-0 items-center gap-1.5 text-meta text-faint">
        {waitingFor ? (
          <span className="min-w-0 flex-1 truncate font-medium text-warn">{waitingFor}</span>
        ) : draft !== null && status !== 'needs-you' && status !== 'running' ? (
          // Nothing going on: the draft takes the line. Needs you and Working keep theirs; only the pen shows then.
          <span className="min-w-0 flex-1 truncate" data-row-draft>
            <span className="text-muted">Draft: </span>
            <span className="text-text/80 italic">{draft}</span>
          </span>
        ) : (
          <>
            {status !== 'unread' && branch && <GitBranch size={11} className={`shrink-0 ${data.isWorktree ? 'text-accent-ink/80' : ''}`} aria-hidden />}
            {/* Finished with something you haven't read: say so where the branch would be. */}
            <span className="min-w-0 flex-1 truncate">{(status === 'unread' ? ['Finished, unread', filtered ? null : projectName].filter(Boolean) : place).join(' · ')}</span>
          </>
        )}
        {/* The rail and the age's colour already say needs you, working and unread; the icon is for the rest. */}
        {!statusRail && <StatusIcon status={status} />}
      </span>
    </span>
  );

  return (
    <button
      {...common}
      className={`relative flex w-full items-center gap-2.5 rounded-lg pr-2.5 pl-3 text-left ${style === 'large' ? 'h-12' : 'h-11'} ${surface}`}
    >
      {rail}
      {/* The project's icon tells rows from different projects apart inside a status group. */}
      {icon(style === 'large' ? 24 : 18)}
      {lines}
    </button>
  );
});

/**
 * A sentence for the sidebar's polite live region when a session starts waiting for you (a permission
 * or a question). Only new arrivals count, not the ones already waiting when the list loaded, and the
 * text clears after a while so the same session waiting again is announced again.
 */
function useWaitingAnnouncement(rows: SessionRowData[], loaded: boolean): string {
  const [notice, setNotice] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const clear = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(clear.current), []);
  useEffect(() => {
    if (!loaded) return;
    const waiting = rows.filter((row) => row.live?.status === 'needs-you');
    const before = seen.current;
    seen.current = new Set(waiting.map((row) => row.id));
    const fresh = before ? waiting.filter((row) => !before.has(row.id)) : [];
    if (fresh.length === 0) return;
    setNotice(fresh.length === 1 ? `“${fresh[0]!.title}” is waiting for you.` : `${fresh.length} sessions are waiting for you.`);
    clearTimeout(clear.current);
    clear.current = setTimeout(() => setNotice(''), 5_000);
  }, [rows, loaded]);
  return notice;
}

export function Sidebar() {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const waiting = useHosts((s) => s.permissions.size);
  const search = useSessions((s) => s.filter);
  const selectedId = useSessions((s) => s.selectedId);
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const complete = useSessions((s) => s.complete);
  const loaded = useSessions((s) => s.loaded);
  const view = useSessions((s) => s.view);
  // Home is the main area with no session open (also behind Settings when it was opened from there).
  const atHome = useSessions((s) => (s.view === 'session' || (s.view === 'settings' && s.settingsFrom === 'session')) && s.mainId === null);
  // Settings is a sheet over the session, which stays selected in the list behind it.
  const listView = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const { setFilter: setSearch, select, setView } = useSessions.getState();
  const projectFilter = useProjects((s) => s.filter);
  const archivedOpen = useProjects((s) => s.archivedOpen);
  const queue = useQueue();
  const queueEntries = useMemo(() => queueInList(queue.entries, { search, project: projectFilter }), [queue.entries, search, projectFilter]);
  const queueReady = queueEntries.filter((e) => e.state === 'ready').length;
  const sectionsOpen = useSidebarSections((s) => s.open);
  // Search and the project filter show every section; the saved state comes back when they're cleared.
  const closed = useMemo(() => closedSections(sectionsOpen, { search, project: projectFilter }), [sectionsOpen, search, projectFilter]);
  const { toggleArchived } = useProjects.getState();
  const noProjects = useProjects((s) => s.loaded && addedProjects(s.projects).length === 0);
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const now = useNow();
  const sidebarStyle = usePreferences((s) => s.prefs.sidebarStyle);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const updatePrefs = usePreferences((s) => s.update);
  const width = useSidebar((s) => s.width);
  // Unsent messages: a pen (and the draft's start) on their rows, the count in the footer, a pen on + for New session's.
  const unsent = useUnsent();
  const draftPreviews = useMemo(() => new Map(unsent.flatMap((e) => (e.item.kind === 'session' ? [[e.item.sessionId, e.item.preview] as const] : []))), [unsent]);
  const newDraft = useNewSessionDraft();

  const all = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const { active, archived } = useMemo(() => buildSessionList(all, { search, project: projectFilter, now }), [all, search, projectFilter, now]);
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const row of all) {
      const entry = map.get(row.projectRoot) ?? { total: 0, active: 0 };
      entry.total++;
      if (isActive(row, now)) entry.active++;
      map.set(row.projectRoot, entry);
    }
    return map;
  }, [all, now]);

  // Sections (Needs you, Working, the Queue, Pinned, Today, Yesterday, Earlier), then Archived while it's open. Closed
  // sections keep their header (and the open session's row). Closed, Archived is docked under the list; while
  // searching, its matches are listed under the rest.
  const searching = search.trim() !== '';
  const archivedAt = archivedPlacement(archived.length, { open: archivedOpen, searching });
  const listSelected = listView === 'session' ? selectedId : null;
  const rows = useMemo(
    () => buildListRows(active, archived, { now, archivedOpen: archivedAt === 'list', queue: { entries: queueEntries, ready: queueReady }, closed, selectedId: listSelected }),
    [active, archived, archivedAt, now, queueEntries, queueReady, closed, listSelected],
  );
  const queueMenus = useQueueMenu(queue.rows);
  const drag = useQueueDrag();
  /** A header's chevron or label: that section, or (⌥-click) every section. */
  const toggleSection = useCallback((section: SectionKey, all: boolean) => {
    const sections = useSidebarSections.getState();
    if (all) sections.toggleAll(section);
    else sections.toggle(section);
  }, []);
  // What each waiting session asks for, from its oldest open request. Sessions waiting in another app have none.
  const permissions = useHosts((s) => s.permissions);
  const waitingTool = useMemo(() => {
    const map = new Map<string, { tool: string; at: number }>();
    for (const request of permissions.values()) {
      const seen = map.get(request.sessionId);
      if (!seen || request.createdAt < seen.at) map.set(request.sessionId, { tool: request.toolName, at: request.createdAt });
    }
    return map;
  }, [permissions]);

  // The sessions on screen, in list order: what ⇧-click ranges run over, and the picks that still count.
  const order = useMemo(() => rows.flatMap((r) => (r.kind === 'session' ? [r.data.id] : [])), [rows]);
  const picked = useMemo(() => new Set(visiblePicks(picks, order)), [picks, order]);
  const pickedRows = rows.flatMap((r) => (r.kind === 'session' && picked.has(r.data.id) ? [r.data] : []));
  const multi = picked.size > 1;
  const headerSessions = useMemo(() => sessionsByHeader(rows), [rows]);
  const menus = useSessionMenu(order, () => setPicks(NO_PICKS));
  const { showMenu: setMenu, requestDelete: setDeleting, requestRename: setRenaming, flagAll } = menus;
  const togglePicked = (id: string) => setPicks((p) => togglePick(p, id, selectedId, order));
  /** "Select all" for a header while picking (Archived only while it's open, when its sessions are listed). */
  const selectAll = (group: HeaderKey) => {
    const ids = headerSessions.get(group) ?? [];
    if (!multi || ids.length === 0) return null;
    const all = ids.every((id) => picked.has(id));
    return <SelectAllButton group={group} all={all} onClick={() => setPicks((p) => pickGroup(p, ids, !all))} />;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const archivedIndex = rows.findIndex((row) => row.kind === 'archived');
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rowHeight(rows[i]!, sidebarStyle),
    // Keyed by row, not index: archiving or unarchiving moves the headers without changing the count,
    // and the virtualiser only recomputes positions when the count or this function changes.
    getItemKey: useCallback((i: number) => {
      const row = rows[i]!;
      return row.kind === 'session'
        ? row.data.id
        : row.kind === 'group'
          ? `group-${row.group}`
          : row.kind === 'hidden'
            ? `hidden-${row.group}`
            : row.kind === 'queue'
              ? `queue-${row.entry.item.id}`
              : row.kind === 'queue-header'
                ? 'queue-header'
                : 'archived-header';
    }, [rows]),
    // The Archived header is always rendered, even far below the fold: it slides in from the dock and keeps focus.
    rangeExtractor: useCallback(
      (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return archivedIndex === -1 || indexes.includes(archivedIndex) ? indexes : [...indexes, archivedIndex].sort((a, b) => a - b);
      },
      [archivedIndex],
    ),
    overscan: 10,
  });
  // Row heights change with the sidebar style, and a header's height with its place (the first has less room above).
  useEffect(() => virtualizer.measure(), [sidebarStyle, rows, virtualizer]);

  // Archived moves between the dock under the list and its place in the list, right under the last active row.
  // Opening, the header slides up from the dock (FLIP) while the list scrolls it near the top when it would land
  // low, and its sessions fade in after; closing, they fade out and the header slides back down to the dock.
  const dockRef = useRef<HTMLDivElement>(null);
  const [archivedMotion, setArchivedMotion] = useState<'opening' | 'closing' | null>(null);
  /** Set just before Archived opens or closes: where its header was, for the layout effect to animate from. */
  const archivedMove = useRef<{ to: 'list' | 'dock'; from: number | null; focus: boolean } | null>(null);
  const stopArchivedMotion = useRef<(() => void) | null>(null);
  useEffect(() => () => stopArchivedMotion.current?.(), []);
  const archivedToggle = (where: 'list' | 'dock') =>
    (where === 'dock' ? dockRef.current : scrollRef.current?.querySelector('[data-archived-header]'))?.querySelector<HTMLElement>('[data-archived-toggle]') ?? null;
  const toggleArchivedSection = () => {
    stopArchivedMotion.current?.();
    stopArchivedMotion.current = null;
    // While searching the header stays in the list either way.
    if (searching) return toggleArchived();
    // Clicked again while its sessions fade out: it stays open.
    if (archivedMotion === 'closing') return setArchivedMotion(null);
    const focus = !!document.activeElement?.closest('[data-archived-dock], [data-archived-header]');
    if (!archivedOpen) {
      archivedMove.current = { to: 'list', from: archivedToggle('dock')?.getBoundingClientRect().top ?? null, focus };
      setArchivedMotion('opening');
      toggleArchived();
      return;
    }
    const close = () => {
      stopArchivedMotion.current = null;
      archivedMove.current = { to: 'dock', from: archivedToggle('list')?.getBoundingClientRect().top ?? null, focus };
      setArchivedMotion(null);
      toggleArchived();
    };
    if (reducedMotion()) return close();
    setArchivedMotion('closing');
    const timer = window.setTimeout(close, 100);
    stopArchivedMotion.current = () => window.clearTimeout(timer);
  };
  useLayoutEffect(() => {
    const move = archivedMove.current;
    if (!move) return;
    archivedMove.current = null;
    const list = scrollRef.current;
    const toggle = archivedToggle(move.to);
    if (move.focus) toggle?.focus({ preventScroll: true });
    if (!list || !toggle) return setArchivedMotion(null);
    const still = reducedMotion() || move.from === null;
    if (move.to === 'list') {
      const header = toggle.closest<HTMLElement>('[data-archived-header]')!;
      const offset = rows.slice(0, archivedIndex).reduce((top, row) => top + rowHeight(row, sidebarStyle), 0);
      const start = list.scrollTop;
      // Set directly rather than with scrollToIndex: that keeps pulling the list back to the row for a few seconds
      // whenever the rows change, as unarchiving does.
      const end = archivedRevealTop(offset, { scrollTop: start, height: list.clientHeight, maxScroll: list.scrollHeight - list.clientHeight }) ?? start;
      if (still) {
        list.scrollTop = end;
        return setArchivedMotion(null);
      }
      // The scroll and the slide run on the same frames, so the header moves in one line from the dock to its place.
      const from = move.from!;
      const natural = toggle.getBoundingClientRect().top;
      const to = natural - (end - start);
      stopArchivedMotion.current = tween(
        200,
        (t) => {
          list.scrollTop = start + (end - start) * t;
          header.style.transform = `translateY(${from + (to - from) * t - (natural - (list.scrollTop - start))}px)`;
        },
        () => {
          header.style.transform = '';
          stopArchivedMotion.current = null;
          setArchivedMotion(null);
        },
      );
      return;
    }
    if (still) return;
    // Back to the dock, from wherever the header was in sight.
    const dock = dockRef.current!;
    const to = toggle.getBoundingClientRect().top;
    const bounds = list.getBoundingClientRect();
    const from = Math.min(Math.max(move.from!, bounds.top), to);
    stopArchivedMotion.current = tween(
      200,
      (t) => (dock.style.transform = `translateY(${(from - to) * (1 - t)}px)`),
      () => {
        dock.style.transform = '';
        stopArchivedMotion.current = null;
      },
    );
  }, [rows]);

  // One Tab stop for the whole list: the selected row while it's rendered, else the first rendered one.
  const virtualItems = virtualizer.getVirtualItems();
  const renderedIds = virtualItems.flatMap((item) => {
    const row = rows[item.index];
    return row?.kind === 'session' ? [row.data.id] : [];
  });
  const tabStopId = listView === 'session' && selectedId && renderedIds.includes(selectedId) ? selectedId : (renderedIds[0] ?? null);
  // The queue has its own Tab stop: its first item.
  const firstQueued = queueEntries[0]?.item.id ?? null;

  // The rail asked to show a section: scroll its header into view and focus it.
  const reveal = useSidebarSections((s) => s.reveal);
  useEffect(() => {
    if (!reveal) return;
    const index = rows.findIndex((row) => sectionOfHeader(row) === reveal.section);
    if (index === -1) return;
    virtualizer.scrollToIndex(index, { align: 'start' });
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-section-toggle="${reveal.section}"]`)?.focus({ preventScroll: true }));
    // Only a new request scrolls; the rows changing afterwards must not pull the list back.
  }, [reveal]);

  const focusRow = (id: string) =>
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));

  // ⌘-click adds a row to the selection, ⇧-click selects a range, ⌥-click opens it in the other pane.
  const rowClick = (event: MouseEvent, data: SessionRowData) => {
    if (modKey(event)) togglePicked(data.id);
    else if (event.shiftKey) setPicks((p) => rangePick(p, data.id, selectedId, order));
    else {
      setPicks(NO_PICKS);
      if (event.altKey) useSessions.getState().openBeside(data.id);
      else select(data.id);
    }
  };

  // ↑/↓ moves through visible sessions, like a native source list (⇧ extends the selection); ⌘A picks the
  // focused row's group; ⌘⌫ deletes the picked sessions, or the focused (else the selected) one; F2 renames it.
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // ← → on a section header close and open it, Archived's too.
    if (target.closest('[data-archived-header]') && matches(event.nativeEvent, 'sidebar.section-toggle')) {
      event.preventDefault();
      if ((event.key === 'ArrowRight') !== archivedOpen) toggleArchivedSection();
      return;
    }
    const header = target.closest<HTMLElement>('[data-section-toggle]');
    if (header && matches(event.nativeEvent, 'sidebar.section-toggle')) {
      const section = header.dataset.sectionToggle;
      if (isSectionKey(section)) {
        event.preventDefault();
        useSidebarSections.getState().setOpen(section, event.key === 'ArrowRight');
      }
      return;
    }
    // ↑ ↓ on a queued item move between queued items (they aren't sessions to select).
    const queued = target.closest<HTMLElement>('[data-queue-item]')?.dataset.queueItem;
    if (queued) {
      if (!matches(event.nativeEvent, 'sidebar.move')) return;
      event.preventDefault();
      const ids = queueEntries.map((e) => e.item.id);
      const next = ids[ids.indexOf(queued) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      virtualizer.scrollToIndex(rows.findIndex((r) => r.kind === 'queue' && r.entry.item.id === next), { align: 'auto' });
      requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(next)}"]`)?.focus({ preventScroll: true }));
      return;
    }
    if (matches(event.nativeEvent, 'sidebar.clear-selection') && picked.size > 0) {
      event.preventDefault();
      event.stopPropagation();
      setPicks(NO_PICKS);
      return;
    }
    if (matches(event.nativeEvent, 'sidebar.select-group')) {
      const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? selectedId;
      const group = [...headerSessions.values()].find((ids) => focused && ids.includes(focused));
      if (group) {
        event.preventDefault();
        setPicks((p) => pickGroup(p, group));
      }
      return;
    }
    if (matches(event.nativeEvent, 'sidebar.delete')) {
      // Like ⌘A, the focused row wins over the open one.
      const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? selectedId;
      const selected = rows.find((r) => r.kind === 'session' && r.data.id === focused);
      const targets = multi ? pickedRows.filter((row) => row.summary) : selected?.kind === 'session' && selected.data.summary ? [selected.data] : [];
      if (targets.length) {
        event.preventDefault();
        setDeleting(targets);
      }
      return;
    }
    if (matches(event.nativeEvent, 'sidebar.rename') && !multi) {
      const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? selectedId;
      const target = rows.find((r) => r.kind === 'session' && r.data.id === focused);
      if (target?.kind === 'session' && target.data.summary) {
        event.preventDefault();
        setRenaming(target.data);
      }
      return;
    }
    const extend = matches(event.nativeEvent, 'sidebar.select');
    if (!extend && !matches(event.nativeEvent, 'sidebar.move')) return;
    event.preventDefault();
    if (extend) {
      const next = stepPick(picks, event.key === 'ArrowDown' ? 1 : -1, selectedId, order);
      if (!next?.end) return;
      setPicks(next);
      virtualizer.scrollToIndex(rows.findIndex((r) => r.kind === 'session' && r.data.id === next.end), { align: 'auto' });
      focusRow(next.end);
      return;
    }
    setPicks(NO_PICKS);
    const ids = rows.flatMap((r, index) => (r.kind === 'session' ? [{ id: r.data.id, index }] : []));
    if (ids.length === 0) return;
    const current = ids.findIndex((r) => r.id === selectedId);
    // ↓ from the last row goes on to the docked Archived header.
    if (event.key === 'ArrowDown' && current === ids.length - 1 && archivedAt === 'dock') {
      archivedToggle('dock')?.focus();
      return;
    }
    const next = ids[current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))]!;
    select(next.id);
    virtualizer.scrollToIndex(next.index, { align: 'auto' });
    // Focus follows the selection, so VoiceOver reads the new row and Tab stays where you are.
    focusRow(next.id);
  };

  /** On the docked Archived header: ↑ goes back to the last row of the list, → opens it. */
  const onDockKeyDown = (event: KeyboardEvent) => {
    if (matches(event.nativeEvent, 'sidebar.section-toggle')) {
      event.preventDefault();
      if (event.key === 'ArrowRight') toggleArchivedSection();
      return;
    }
    if (event.key !== 'ArrowUp' || !matches(event.nativeEvent, 'sidebar.move')) return;
    const last = order.at(-1);
    if (!last) return;
    event.preventDefault();
    setPicks(NO_PICKS);
    select(last);
    virtualizer.scrollToIndex(rows.findIndex((r) => r.kind === 'session' && r.data.id === last), { align: 'auto' });
    focusRow(last);
  };

  // What the picked sessions can do: only indexed ones have flags and a transcript to delete.
  const pickTargets = pickedRows.filter((row) => row.summary);
  const pickActive = pickTargets.filter((row) => isActive(row, now));
  const pickArchived = pickTargets.filter((row) => !isActive(row, now));
  const allPinned = pickTargets.length > 0 && pickTargets.every((row) => row.pinned);
  const actOnPicks = (targets: SessionRowData[], change: FlagChange) => () => {
    flagAll(targets, change);
    setPicks(NO_PICKS);
  };

  /** The menu for several picked sessions: the same actions as the selection bar. */
  const pickedMenu = (at: { x: number; y: number }) => {
    const count = (rows: SessionRowData[]) => `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}`;
    const entries: MenuEntry[] = [{ heading: `${picked.size} selected` }];
    if (pickActive.length) entries.push({ label: `Archive ${count(pickActive)}`, hint: 'until new activity', onSelect: actOnPicks(pickActive, ARCHIVE) });
    if (pickArchived.length) entries.push({ label: `Unarchive ${count(pickArchived)}`, onSelect: actOnPicks(pickArchived, { archived: false }) });
    if (pickTargets.length) entries.push({ label: `${allPinned ? 'Unpin' : 'Pin'} ${count(pickTargets)}`, onSelect: actOnPicks(pickTargets, { pinned: !allPinned }) });
    entries.push('separator', { label: 'Clear selection', hint: 'Esc', onSelect: () => setPicks(NO_PICKS) });
    if (pickTargets.length) entries.push('separator', { label: `Delete ${count(pickTargets)}…`, hint: '⌘⌫', danger: true, onSelect: () => setDeleting(pickTargets) });
    setMenu({ ...at, label: `${picked.size} selected sessions`, entries });
  };

  const sessionMenu = (at: { x: number; y: number }, data: SessionRowData) => {
    if (multi && picked.has(data.id)) return pickedMenu(at);
    setPicks(NO_PICKS);
    menus.openSessionMenu(at, data);
  };

  // Only open sessions the main list shows: a process idling elsewhere sits under Archived and
  // would make the count disagree with what's visible.
  const liveCount = all.filter((row) => row.live !== null && isActive(row, now)).length;
  const waitingNotice = useWaitingAnnouncement(all, loaded);

  return (
    // Drawn at the open width even while the frame around it eases narrower or wider, so it slides rather than reflows.
    <aside aria-label="Sidebar" className="relative flex h-full shrink-0 flex-col border-r border-border bg-sidebar" style={{ width }} data-sidebar-open>
      {/* Traffic lights on the left (macOS); the bar doubles as a window drag handle. */}
      <div className={`drag flex h-13 shrink-0 items-center gap-2 ${currentPlatform() === 'darwin' ? 'pl-24' : 'pl-4.5'}`}>
        <span className="text-body font-semibold text-text/90">Switchboard</span>
      </div>

      {/* The session list stays while Settings is open (a sheet over the main area), so "Needs you" stays in view. */}
      <div className="flex items-center gap-1.5 px-3 pb-1.5">
        {/* A real field on the darkest surface, so it reads as the place to type. */}
        <label className="no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-bg px-2.5 text-faint focus-within:ring-1 focus-within:ring-accent-ink/50">
          <Search size={14} className="shrink-0" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions by title, project or branch"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-muted"
          />
        </label>
        <Button
          variant="quiet"
          size="lg"
          iconOnly
          icon={<House size={15} aria-hidden />}
          aria-label="Home"
          shortcut="home"
          selected={atHome}
          data-go-home
          onClick={() => useSessions.getState().goHome()}
          aria-current={atHome ? 'page' : undefined}
          className="no-drag shrink-0 rounded-lg!"
        />
        {/* The sidebar's one primary action: a yellow fill, like every primary button. With an unsent New session
            prompt it carries a pen, and opens New session on that prompt's project. */}
        <span className="no-drag relative flex shrink-0">
          <Button
            variant="primary"
            size="lg"
            iconOnly
            icon={<Plus size={17} strokeWidth={2.4} aria-hidden />}
            aria-label={newDraft ? newSessionDraftTooltip(newDraft.name) : 'New session'}
            shortcut="session.new"
            data-new-session
            onClick={() => (newDraft ? openDraft(newDraft.item) : useSessions.getState().openNewSession())}
            className={`rounded-lg! ${view === 'new' ? 'ring-2 ring-accent/40 ring-offset-1 ring-offset-sidebar' : ''}`}
          />
          {newDraft && <PenBadge className="absolute -top-1.5 -right-1.5" data-new-session-draft={newDraft.item.root ?? ''} />}
        </span>
      </div>

      <ProjectFilter counts={counts} />
      {noProjects && (
        <div className="mx-3 mb-2 grid justify-items-start gap-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-ui" data-sidebar-onboarding>
          <p className="font-medium text-text">Add a project</p>
          <p className="text-muted">Choose the folders you work in. They are offered when you start a session.</p>
          <button type="button" onClick={() => useProjects.getState().showAdd(true)} className="mt-1 text-link hover:underline">
            Add project…
          </button>
        </div>
      )}

      {/* Keys go to the list and the selection bar floating over it, so Esc clears picks from either. */}
      <div onKeyDown={onKeyDown} className="relative flex min-h-0 flex-1 flex-col">
      {/* While picking, the list scrolls far enough for its last rows to clear the floating bar. */}
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto px-2 ${multi ? 'pb-36' : 'pb-2'}`} data-session-list>
        {loaded && rows.length === 0 ? (
          <div className="grid justify-items-start gap-2 px-2 py-4 text-ui text-muted" data-empty-sidebar>
            <p>
              {search
                ? `No sessions match “${search.trim()}”. Search looks at titles, projects and branches; ⌘⇧F searches inside conversations.`
                : projectFilter
                  ? `No sessions in this project yet. Start one with ${formatKeys(keysFor('session.new'))}.`
                  : scope === 'switchboard'
                    ? `Sessions you start or continue in Switchboard show up here. Start one with ${formatKeys(keysFor('session.new'))}.`
                    : `No Claude Code sessions found yet. Start one with ${formatKeys(keysFor('session.new'))}.`}
            </p>
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-link hover:underline">
                Clear search
              </button>
            )}
            {scope === 'switchboard' && sessions.size > 0 && (
              <button type="button" onClick={() => updatePrefs({ sessionScope: 'all' })} className="text-link hover:underline">
                Show sessions from other apps
              </button>
            )}
          </div>
        ) : (
          // Virtualised: only rows near the viewport exist, so each item says where it sits in the whole list.
          <div role="list" aria-label="Sessions" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((item) => {
              const row = rows[item.index]!;
              const isPicked = (r: SidebarListRow | undefined) => multi && r?.kind === 'session' && picked.has(r.data.id);
              // A run of picked rows shares one tinted block: rounded where the run starts and ends.
              const block = isPicked(row) && { top: !isPicked(rows[item.index - 1]), bottom: !isPicked(rows[item.index + 1]) };
              return (
                <div
                  key={item.key}
                  role="listitem"
                  aria-setsize={rows.length}
                  aria-posinset={item.index + 1}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}
                  // Archived sessions fade in once their header has landed, and out before it goes back to the dock.
                  className={row.kind === 'session' && row.archived ? `transition-opacity ${archivedMotion === 'closing' ? 'duration-100' : 'duration-150'} ${archivedMotion ? 'opacity-0' : ''}` : undefined}
                >
                  {block && (
                    <div
                      aria-hidden
                      data-pick-block
                      className={`absolute inset-x-0 top-0 border-x border-accent-ink/25 bg-accent-ink/10 ${block.top ? 'rounded-t-lg border-t' : ''} ${block.bottom ? 'rounded-b-lg border-b' : ''}`}
                      style={{ bottom: block.bottom ? SESSION_ROW_GAP[sidebarStyle] : 0 }}
                    />
                  )}
                  {row.kind === 'group' || row.kind === 'queue-header' ? (
                    <GroupHeader row={row} selectAll={row.kind === 'group' ? selectAll(row.group) : null} onToggle={toggleSection} />
                  ) : row.kind === 'hidden' ? (
                    <p className="flex h-full items-start justify-end px-3 text-meta text-faint" data-section-hidden={row.group}>
                      +{row.count} hidden
                    </p>
                  ) : row.kind === 'queue' ? (
                    <QueueRow
                      entry={row.entry}
                      now={now}
                      style={sidebarStyle}
                      tabbable={row.entry.item.id === firstQueued}
                      mark={drag.markFor(row.entry.item.id)}
                      drag={drag.props(row.entry.item.id)}
                      onMenu={queueMenus.openMenu}
                      onKeyDown={queueMenus.onKeyDown}
                    />
                  ) : row.kind === 'session' ? (
                    <SessionRow
                      data={row.data}
                      archived={row.archived}
                      picked={multi && picked.has(row.data.id)}
                      picking={multi}
                      selected={listView === 'session' && row.data.id === selectedId}
                      beside={listView === 'session' && splitId !== null && row.data.id !== selectedId && (row.data.id === mainId || row.data.id === splitId)}
                      now={now}
                      tabbable={row.data.id === tabStopId}
                      waitingFor={rowStatus(row.data) === 'needs-you' ? waitingLabel(waitingTool.get(row.data.id)?.tool ?? null) : null}
                      draft={draftPreviews.get(row.data.id) ?? null}
                      onClick={rowClick}
                      onTogglePick={togglePicked}
                      onMenu={sessionMenu}
                      onMiddleClick={menus.middleClick}
                    />
                  ) : (
                    // Like a section header: the label sits at the foot of the row, just above its sessions.
                    <div className="flex h-full items-end px-2.5 pb-1.5" data-archived-header>
                      <ArchivedHeader count={row.count} open={row.open} onToggle={toggleArchivedSection} action={selectAll('archived')} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {multi && (
        // Floats over the list's bottom edge, like a sheet, and holds every action for the picks with its keys.
        <div className="absolute inset-x-2 bottom-2 z-10 grid gap-2 rounded-xl border overlay p-2.5" role="toolbar" aria-label="Selected sessions" data-selection-bar>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-meta font-semibold tabular-nums text-on-accent" data-selection-count={picked.size}>
              {picked.size}
            </span>
            <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text">sessions selected</span>
            <Button variant="quiet" size="sm" shortcut="sidebar.clear-selection" onClick={() => setPicks(NO_PICKS)} data-clear-selection className="shrink-0">
              Clear
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {pickActive.length > 0 || pickArchived.length === 0 ? (
              <Button icon={<Archive size={13} className="shrink-0" aria-hidden />} data-archive-selected disabled={pickActive.length === 0} onClick={actOnPicks(pickActive, ARCHIVE)} className={pickButton}>
                <span className="truncate">Archive</span>
              </Button>
            ) : (
              <Button icon={<ArchiveRestore size={13} className="shrink-0" aria-hidden />} data-unarchive-selected onClick={actOnPicks(pickArchived, { archived: false })} className={pickButton}>
                <span className="truncate">Unarchive</span>
              </Button>
            )}
            <Button
              icon={allPinned ? <PinOff size={13} className="shrink-0" aria-hidden /> : <Pin size={13} className="shrink-0" aria-hidden />}
              data-pin-selected
              disabled={pickTargets.length === 0}
              onClick={actOnPicks(pickTargets, { pinned: !allPinned })}
              className={pickButton}
            >
              <span className="truncate">{allPinned ? 'Unpin' : 'Pin'}</span>
            </Button>
            <Button variant="danger" icon={<Trash2 size={13} className="shrink-0" aria-hidden />} data-delete-selected disabled={pickTargets.length === 0} onClick={() => setDeleting(pickTargets)} className={pickButton}>
              <span className="truncate">Delete…</span>
            </Button>
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-faint">
            {([[keysFor('sidebar.select-group'), 'all in group'], ['⇧↑↓', 'extend'], [keysFor('sidebar.delete'), 'delete']] as const).map(([key, what]) => (
              <span key={key} className="flex items-center gap-1">
                <Kbd keys={key} /> {what}
              </span>
            ))}
          </p>
        </div>
      )}
      </div>

      {/* Closed, Archived is docked under the list, so a short list never scrolls and a long one keeps it in sight. */}
      {archivedAt === 'dock' && (
        <div ref={dockRef} onKeyDown={onDockKeyDown} className="relative z-10 flex h-9 shrink-0 items-center border-t border-border bg-sidebar px-4.5" data-archived-dock>
          <ArchivedHeader count={archived.length} open={false} onToggle={toggleArchivedSection} />
        </div>
      )}

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-meta text-muted">
        {/* The focus limit, while it's on: how many sessions are going, out of how many. */}
        <FocusCounter />
        <span className="min-w-0 flex-1 truncate">
          {all.length} {all.length === 1 ? 'session' : 'sessions'}{liveCount > 0 && ` · ${liveCount} open`}
          {queue.entries.length > 0 && <span data-footer-queued>{` · ${queue.entries.length} queued`}</span>}
          {waiting > 0 && <span className="text-warn">{` · ${waiting} waiting`}</span>}
          {!complete && loaded && ' · scanning…'}
        </span>
        {unsent.length > 0 && (
          <Pill
            icon={<PencilLine size={11} className="shrink-0" aria-hidden />}
            onClick={() => (useDrafts.getState().list ? useDrafts.getState().closeList() : openUnsentList())}
            aria-haspopup="dialog"
            aria-label={`${unsent.length} unsent ${unsent.length === 1 ? 'message' : 'messages'}. Show them`}
            data-drafts-count={unsent.length}
            className="shrink-0"
          >
            {unsent.length} unsent
          </Pill>
        )}
        <Button
          variant="quiet"
          iconOnly
          icon={<FolderCog size={15} aria-hidden />}
          aria-label="Projects"
          selected={view === 'projects' || view === 'project'}
          aria-current={view === 'projects' || view === 'project' ? 'page' : undefined}
          data-open-projects
          onClick={() => setView(view === 'projects' ? 'session' : 'projects')}
        />
        <Button
          variant="quiet"
          iconOnly
          icon={<Settings size={15} aria-hidden />}
          aria-label="Settings"
          shortcut="settings"
          selected={view === 'settings'}
          aria-current={view === 'settings' ? 'page' : undefined}
          data-open-settings
          onClick={() => (view === 'settings' ? useSessions.getState().closeSettings() : useSessions.getState().openSettings())}
        />
      </footer>

      <p className="sr-only" aria-live="polite" data-waiting-announcement>
        {waitingNotice}
      </p>
      {menus.overlays}
      {queueMenus.overlay}
    </aside>
  );
}
