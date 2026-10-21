import { useState } from 'react';
import { create } from 'zustand';
import { archiveRunTree, deleteRunTree, stopRunNow, usePipelines } from '../../state/pipelinesStore.ts';
import { deleteTreeText, runGoesOn, treeRunsOf, treeSessionCount } from '../../state/runTree.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';

// A pipeline run as one thing in the sidebar (#179): archive and delete its tree (the parent, a session or the run row,
// and its sub-sessions) from any menu. The questions they ask are rendered once per window (`RunTreeDialogs`).

interface Ask {
  kind: 'archive' | 'delete';
  /** The session, or the run row's run, the tree hangs from. */
  parentId: string;
  title: string;
}

const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The runs of the tree hanging from a session or a run row. */
const runsOf = (parentId: string) => treeRunsOf(usePipelines.getState().runs.values(), parentId);

/** Whether a session (or a run row) is the parent of a run's tree: its Archive and Delete… take the tree. */
export const isTreeParent = (parentId: string) => runsOf(parentId).length > 0;

/** How many sub-sessions the tree under a parent has. */
export const treeSize = (parentId: string) => treeSessionCount(runsOf(parentId));

/** The parent and its sub-sessions, with their titles: what archiving puts away. */
function treeTargets(parentId: string, title: string): Array<{ id: string; title: string }> {
  const sessions = useSessions.getState().sessions;
  const steps = runsOf(parentId).flatMap((state) => state.steps.flatMap((step) => (step.sessionId ? [{ id: step.sessionId, title: sessions.get(step.sessionId)?.title ?? step.step }] : [])));
  return [{ id: parentId, title }, ...steps.filter((step, i) => steps.findIndex((s) => s.id === step.id) === i)];
}

/**
 * Archives the tree as a session is archived: an unsent message in it asks first, and whatever of it is open closes.
 */
function putAway(parentId: string, title: string, runId: string): void {
  archiveSessions(treeTargets(parentId, title), () => void archiveRunTree(runId, true).catch((error: unknown) => toast(`Couldn't archive the run: ${describe(error)}`)));
}

/**
 * Archives (or unarchives) the tree under a parent in one go. A run that still goes on asks first (Stop and archive).
 * False when the parent has no run: archive it as a session.
 */
export function archiveTree(parentId: string, archived: boolean, title: string): boolean {
  const runs = runsOf(parentId);
  if (!runs.length) return false;
  if (archived && runs.some(runGoesOn)) {
    useAsk.setState({ ask: { kind: 'archive', parentId, title } });
    return true;
  }
  if (archived) putAway(parentId, title, runs[0]!.run.id);
  else void archiveRunTree(runs[0]!.run.id, false).catch((error: unknown) => toast(`Couldn't unarchive the run: ${describe(error)}`));
  return true;
}

/** Delete… on a run row or a parent: asks, with Keep the sub-sessions. False when the parent has no run. */
export function askDeleteTree(parentId: string, title: string): boolean {
  if (!isTreeParent(parentId)) return false;
  useAsk.setState({ ask: { kind: 'delete', parentId, title } });
  return true;
}

/** The questions Archive and Delete… on a run's tree ask; render once per window. */
export function RunTreeDialogs() {
  const ask = useAsk((s) => s.ask);
  if (!ask) return null;
  const close = () => useAsk.setState({ ask: null });
  return ask.kind === 'archive' ? <StopAndArchive ask={ask} onClose={close} /> : <DeleteTree key={ask.parentId} ask={ask} onClose={close} />;
}

function StopAndArchive({ ask, onClose }: { ask: Ask; onClose(): void }) {
  const sessions = treeSize(ask.parentId);
  return (
    <ConfirmDialog
      title="Stop the run and archive it?"
      body={`“${ask.title}” is still going. It is stopped first, then archived${sessions ? ` with ${sessions === 1 ? 'its step' : `its ${sessions} steps`}` : ''}.`}
      confirmLabel="Stop and archive"
      data={{ 'data-run-archive-confirm': true }}
      onConfirm={async () => {
        const runs = runsOf(ask.parentId);
        // Never archived while it goes on in the background: stopped first.
        for (const state of runs.filter(runGoesOn)) await stopRunNow(state.run.id);
        if (runs[0]) putAway(ask.parentId, ask.title, runs[0].run.id);
      }}
      onClose={onClose}
    />
  );
}

function DeleteTree({ ask, onClose }: { ask: Ask; onClose(): void }) {
  const [keep, setKeep] = useState(false);
  const runs = runsOf(ask.parentId);
  const sessions = treeSessionCount(runs);
  const parentSession = runs.some((state) => state.run.parentSessionId === ask.parentId);
  const text = deleteTreeText(ask.title, sessions, parentSession, keep);
  return (
    <ConfirmDialog
      title={text.title}
      body={text.body}
      confirmLabel="Delete"
      danger
      data={{ 'data-run-delete-confirm': true }}
      details={
        sessions > 0 && (
          <Checkbox checked={keep} onChange={setKeep} className="w-fit text-ui" dataAttrs={{ 'data-run-delete-keep': true }}>
            Keep the sub-sessions
          </Checkbox>
        )
      }
      onConfirm={async () => {
        const gone = [ask.parentId, ...(keep ? [] : runs.flatMap((state) => state.steps.flatMap((step) => (step.sessionId ? [step.sessionId] : []))))];
        // Every run of the tree goes in one call: the engine deletes the parent's tree from any of them.
        if (runs[0]) await deleteRunTree(runs[0].run.id, keep);
        for (const state of runs.slice(1)) usePipelines.getState().dropRun(state.run.id);
        // Their panes close and the others take the space.
        useSessions.getState().closeSessions(gone);
      }}
      onClose={onClose}
    />
  );
}
