import { currentPlatform } from '../../lib/platform.ts';
import { PanelLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { useRuns } from '../../state/pipelinesStore.ts';
import { withPipelines } from '../../state/pipelineRows.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebarStore.ts';
import { needsYouPill } from '../../state/sidebarOrder.ts';
import { inScope } from '../../state/sidebarRows.ts';
import { useComputers } from '../../state/computersStore.ts';
import { remoteRowId } from '../../state/remoteSelection.ts';
import { openRow, useRemoteRows } from '../../state/useRemoteRows.ts';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';

/**
 * The start of a view's header: the sidebar toggle (⌘B) and, while the sidebar is closed, room for the
 * traffic lights and a pill for the sessions that need you (a click opens the one waiting longest).
 * Only the leftmost header shows it: in split view, the left pane's.
 */
export function SidebarToggle() {
  const state = useShownSidebar().state;
  // The rail because the window is too small: ⌘B hides it, as there is no room to open it.
  const fitted = useSidebar((s) => s.state) !== state;
  const collapsed = usePreferences((s) => s.prefs.sidebarCollapsed);
  const open = state === 'open';
  return (
    // While closed, the traffic lights sit where the sidebar was: the header starts after them. They end
    // 68px in (16px inset plus their width), so this keeps the same 16px clear of them behind a px-4 header.
    // Elsewhere the window's buttons are in its own title bar.
    <div className={`flex shrink-0 items-center gap-2 ${state === 'closed' && currentPlatform() === 'darwin' ? 'ml-17' : ''}`} data-sidebar-toggle-area>
      <Button
        variant="quiet"
        iconOnly
        icon={<PanelLeft size={15} aria-hidden />}
        aria-label={fitted ? 'Hide sidebar' : open ? (collapsed === 'closed' ? 'Hide sidebar' : 'Minimize sidebar') : 'Open sidebar'}
        aria-expanded={open}
        data-tooltip={`Sidebar (${formatKeys(keysFor('sidebar.toggle'))})`}
        shortcut="sidebar.toggle"
        onClick={() => useSidebar.getState().toggle()}
        className="no-drag"
        data-sidebar-toggle={state}
      />
      {state === 'closed' && <NeedsYouPill />}
    </div>
  );
}

function NeedsYouPill() {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  // Sessions on other computers that need you count too, with their open prompts.
  const remoteRows = useRemoteRows();
  const lists = useComputers((s) => s.lists);
  const runs = useRuns();
  const pill = useMemo(() => {
    const remoteRequests = [...lists].flatMap(([computerId, list]) => list.prompts.map((p) => ({ ...p, sessionId: remoteRowId({ computerId, sessionId: p.sessionId }) })));
    return needsYouPill([...withPipelines(toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), runs), ...remoteRows], [...permissions.values(), ...remoteRequests]);
  }, [sessions, live, hosts, permissions, scope, remoteRows, lists, runs]);
  if (!pill) return null;
  return (
    <Pill
      tone="warn"
      onClick={() => openRow(pill.targetId)}
      icon={<span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-warn" />}
      aria-label={`${pill.label}: open the session waiting longest`}
      data-tooltip="Open the session waiting longest"
      className="no-drag font-semibold"
      data-needs-you-pill={pill.count}
    >
      {pill.label}
    </Pill>
  );
}
