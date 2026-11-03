import { sessionsWithDrafts } from '../../state/drafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

const shortTitle = (title: string) => (title.length > 60 ? `${title.slice(0, 59)}…` : title || 'Untitled session');

/**
 * Archives sessions, first asking when one of them holds an unsent message: archiving hides the session, and its
 * draft would be left where you no longer see it. Confirming discards those drafts. An archived session that is
 * open closes, as it would be put away.
 */
export function archiveSessions(targets: ReadonlyArray<{ id: string; title: string }>, archive: () => void): void {
  const ids = sessionsWithDrafts(
    targets.map((t) => t.id),
    useDrafts.getState().drafts,
  );
  const titles = targets.filter((t) => ids.includes(t.id)).map((t) => t.title);
  const archiveAndClose = () => {
    archive();
    useSessions.getState().closeSessions(targets.map((t) => t.id));
  };
  useDrafts.getState().requestArchive({ ids, titles, archive: archiveAndClose }, ids.length > 0);
}

/** The question `archiveSessions` asks. Always mounted, like the palette's dialogs. */
export function ArchiveDraftDialog() {
  const prompt = useDrafts((s) => s.archivePrompt);
  if (!prompt) return null;
  const one = prompt.ids.length === 1;
  return (
    <ConfirmDialog
      title={one ? 'Mark it done and discard the unsent message?' : `Mark them done and discard ${prompt.ids.length} unsent messages?`}
      body={
        one ? (
          <>“{shortTitle(prompt.titles[0] ?? '')}” has a message you haven't sent. Marking it done discards it.</>
        ) : (
          <>{prompt.ids.length} of these sessions have messages you haven't sent. Marking them done discards them.</>
        )
      }
      confirmLabel="Mark done"
      onConfirm={async () => {
        prompt.archive();
        useDrafts.getState().removeDrafts(prompt.ids);
      }}
      onClose={() => useDrafts.getState().closeArchivePrompt()}
    />
  );
}
