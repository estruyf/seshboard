import { restoreFrom, trashName } from '../../lib/platform.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { CopyForAppDialog } from '../memory/CopyForAppDialog.tsx';
import { CopySectionDialog } from '../memory/CopySectionDialog.tsx';
import { ImportDialog } from '../memory/ImportDialog.tsx';
import { RememberDialog } from '../memory/RememberDialog.tsx';
import { ShareDialog } from '../memory/ShareDialog.tsx';
import { RenameProjectDialog } from '../projects/RenameProjectDialog.tsx';
import { RenameSessionDialog } from '../RenameSessionDialog.tsx';
import { TranscriptDiagnosisDialog } from '../transcript/TranscriptDiagnosisDialog.tsx';

const shortTitle = (title: string) => (title.length > 60 ? `${title.slice(0, 59)}…` : title);

/**
 * The dialogs palette commands open (rename, delete, revert all, check transcript, share a memory, copy a section to
 * memory; the Memory tab opens the last two here too). The palette closes before they show,
 * so they live here, always mounted, and open from `usePaletteBus().dialog`.
 */
export function PaletteDialogs() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const dialog = usePaletteBus((s) => s.dialog);
  const live = useSessions((s) => (dialog?.kind === 'delete-session' ? (s.live.get(dialog.sessionId) ?? null) : null));
  const host = useHosts((s) => (dialog?.kind === 'delete-session' ? s.hosts.get(dialog.sessionId) : undefined));
  const close = () => usePaletteBus.getState().showDialog(null);
  if (!dialog) return null;

  switch (dialog.kind) {
    case 'rename-session':
      return <RenameSessionDialog sessionId={dialog.sessionId} title={dialog.title} onClose={close} />;
    case 'rename-project':
      return <RenameProjectDialog root={dialog.root} onClose={close} />;
    case 'delete-session': {
      const runningHere = isActiveHost(host);
      return (
        <ConfirmDialog
          title={`Delete “${shortTitle(dialog.title)}”?`}
          danger
          confirmLabel={`Move to ${trashName()}`}
          blockedReason={live && !runningHere ? 'This session is open in another Claude Code window. Close it there first.' : null}
          body={
            <>
              The conversation and any subagent transcripts move to the {trashName()}, so you can restore them {restoreFrom()}. Files Claude changed in your project are not touched.
              {runningHere && ' It is running in Switchboard and will be stopped first.'}
            </>
          }
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            await client.call('session.delete', { sessionId: dialog.sessionId });
            useDrafts.getState().removeDraft(dialog.sessionId);
            const panes = useSessions.getState();
            // Two panes: the other one takes the full width. One: back Home, rather than keep a trashed session on screen.
            if (panes.splitId && (dialog.sessionId === panes.mainId || dialog.sessionId === panes.splitId)) panes.closePane(dialog.sessionId === panes.mainId ? 'main' : 'split');
            else if (panes.selectedId === dialog.sessionId) panes.closeSession();
          }}
          onClose={close}
        />
      );
    }
    case 'transcript-diagnosis':
      return <TranscriptDiagnosisDialog sessionId={dialog.sessionId} title={dialog.title} onClose={close} />;
    case 'share-memory':
      return <ShareDialog key={dialog.memoryPath} root={dialog.root} memoryPath={dialog.memoryPath} name={dialog.name} onClose={close} />;
    case 'copy-section':
      return <CopySectionDialog key={dialog.file} root={dialog.root} file={dialog.file} onClose={close} />;
    case 'memory-import':
      return <ImportDialog source={dialog.source} onClose={close} />;
    case 'memory-copy-app':
      return <CopyForAppDialog onClose={close} />;
    case 'remember':
      return <RememberDialog text={dialog.text} from={dialog.from} sessionId={dialog.sessionId} root={dialog.root} onClose={close} />;
    case 'revert-all':
      return (
        <ConfirmDialog
          title={dialog.paths.length === 1 ? `Revert ${dialog.paths[0]}?` : `Revert ${dialog.paths.length} files?`}
          danger
          confirmLabel="Revert"
          body={<p>{dialog.paths.length === 1 ? 'Its' : 'Their'} uncommitted changes are lost. New files go to the {trashName()}, so you can get them back from there.</p>}
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            await client.call('git.revert', { cwd: dialog.cwd, paths: dialog.paths });
            // The checkout changed under the session view: its Changes panel and git button read it again.
            useCheckoutBranches.getState().switched();
          }}
          onClose={close}
        />
      );
  }
}
