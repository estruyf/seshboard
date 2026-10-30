import { useEffect } from 'react';
import { SelectionMenu } from '../SelectionMenu.tsx';
import { useReadyReport } from '../../engine/useReadyReport.ts';
import { matches, type ShortcutId } from '../../lib/shortcuts.ts';
import { useAskSync } from '../../state/askStore.ts';
import { useLimitsSync } from '../../state/limitsStore.ts';
import { useSignInSync } from '../../state/signInStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferencesSync } from '../../state/preferencesStore.ts';
import { useProfilesSync } from '../../state/profilesStore.ts';
import { useProjectsSync } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminalsSync } from '../../state/terminalsStore.ts';
import { useThemesSync } from '../../state/themeStore.ts';
import { useUpNextSync } from '../../state/upNextStore.ts';
import { useCatchUpSync } from '../../state/useCatchUpSync.ts';
import { useDraftsSync } from '../../state/useDraftsSync.ts';
import { usePopoutViewReport } from '../../state/useSessionViewSync.ts';
import { useHostsSync } from '../../state/useHostsSync.ts';
import { useModsSync } from '../../state/useModsSync.ts';
import { usePopoutsSync } from '../../state/usePopoutsSync.ts';
import { useRemoteSync } from '../../state/useRemoteSync.ts';
import { useSessionsSync } from '../../state/useSessionsSync.ts';
import { AddContextDialogHost } from '../composer/AddContextDialog.tsx';
import { ArchiveDraftDialog } from '../drafts/ArchiveDraftDialog.tsx';
import { EngineStalledNotice } from '../EngineStalledNotice.tsx';
import { RepoTrustDialog } from '../clone/CloneTrustDialog.tsx';
import { FocusGateDialog } from '../focus/FocusGateDialog.tsx';
import { CommandPalette } from '../palette/CommandPalette.tsx';
import { FilePreviewDialog } from '../filePreview/FilePreviewDialog.tsx';
import { PaletteDialogs } from '../palette/PaletteDialogs.tsx';
import { RunTreeDialogs } from '../pipelines/RunTreeDialogs.tsx';
import { useOverlayShortcuts } from '../palette/useOverlayShortcuts.ts';
import { ShortcutsSheet } from '../shortcuts/ShortcutsSheet.tsx';
import { useSavedPromptsSync } from '../savedPrompts/savedPromptsStore.ts';
import { useSessionShortcuts } from '../session/useSessionShortcuts.ts';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { ToastLayer } from '../ui/Toast.tsx';
import { TooltipLayer } from '../ui/Tooltip.tsx';
import { useUsageSync } from '../UsageBand.tsx';

/**
 * The app's own shortcuts, which need the sidebar, the list of sessions or another session: pressed in a pop-out, they
 * run in the main window, which comes to the front. The session's own shortcuts work here as in a pane, and the
 * command palette and the shortcuts sheet open here, for this session.
 */
const MAIN_WINDOW_KEYS: readonly ShortcutId[] = [
  'session.new',
  'session.question',
  'palette.goto',
  'search',
  'home',
  'sidebar.toggle',
  'session.next',
  'session.previous',
  'session.next-needs-you',
];

/**
 * A pop-out: one session in a window of its own, next to the main window. It is the whole session, as a lone pane
 * is, with all its panels (Changes, Ask, Agents, Commands, the terminal) and its own shortcuts; only the sidebar
 * stays in the main window. It saves nothing of the main window's (its selection, the sidebar's filter, the
 * terminal panel's sizes, unsent messages: those reach the main window through main), and does none of the app-wide
 * work the main window does (the first session shown at launch, links, the editor companion, queue toasts, updates).
 * Settings, Usage, project pages and New session open in the main window (`showInMain`), as do Go to, Search and the
 * palette's commands that start or find another session. The palette and the shortcuts sheet open here, for this session.
 */
export function PopoutApp({ sessionId }: { sessionId: string }) {
  useSessionsSync();
  useHostsSync();
  useRemoteSync();
  useProjectsSync();
  useProfilesSync();
  useTerminalsSync();
  useDraftsSync();
  usePopoutsSync();
  useUsageSync();
  usePreferencesSync();
  useThemesSync();
  useCatchUpSync();
  useUpNextSync();
  useModsSync();
  useLimitsSync();
  useSignInSync();
  useAskSync();
  // Saved prompts reach the slash menu and the message box here too; a change made in any window shows in all.
  useSavedPromptsSync();
  useReadyReport();
  usePopoutWindow(sessionId);
  // Main keeps the session's panels, to give them back to the main window when this one goes.
  usePopoutViewReport(sessionId);
  // The terminal, Open in editor: as in the main window, for this window's session.
  useSessionShortcuts(() => ({ terminalOwner: sessionId, sessionId }));
  // The command palette (⌘K) and the shortcuts sheet (⌘/): here, with this session's commands.
  useOverlayShortcuts();
  const shown = useSessions((s) => s.layout !== null);
  const overlay = useOverlay((s) => s.open);

  return (
    <div className="flex h-full">
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{shown && <TranscriptView sessionId={sessionId} leading={false} />}</main>
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'shortcuts' && <ShortcutsSheet />}
      <SelectionMenu />
      <PaletteDialogs />
      <RunTreeDialogs />
      <FilePreviewDialog />
      <AddContextDialogHost />
      {/* Starting, resuming or forking from here can hit the focus limit; archiving can hold an unsent message. */}
      <FocusGateDialog />
      <RepoTrustDialog />
      <ArchiveDraftDialog />
      <EngineStalledNotice />
      <ToastLayer />
      <TooltipLayer />
    </div>
  );
}

/** The window's session, its title, what main should know about it, and the keys that belong to the main window. */
function usePopoutWindow(sessionId: string): void {
  useEffect(() => {
    useSessions.getState().select(sessionId);
    window.seshboard?.reportFocus(sessionId);
  }, [sessionId]);

  // Closing the session (the header's ×) leaves nothing to show here: the window goes, the session keeps running.
  useEffect(
    () =>
      useSessions.subscribe((state, previous) => {
        if (previous.layout !== null && state.layout === null) window.close();
      }),
    [],
  );

  const title = useSessions((s) => s.sessions.get(sessionId)?.title ?? s.live.get(sessionId)?.name ?? null);
  useEffect(() => {
    document.title = title ? `${title} · Seshboard` : 'Seshboard';
  }, [title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !MAIN_WINDOW_KEYS.some((id) => matches(event, id))) return;
      event.preventDefault();
      const { key, code, metaKey, ctrlKey, altKey, shiftKey } = event;
      window.seshboard?.forwardKeys({ key, code, metaKey, ctrlKey, altKey, shiftKey });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
