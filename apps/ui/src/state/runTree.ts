import type { PipelineRunState } from '@switchboard/protocol/client';

// A pipeline run as one thing in the sidebar (#179): its parent (a session, or the run row) and its sub-sessions. The
// words and rules of its menu and its dialogs, without React or the stores, so they can be tested.

/** The runs of a tree: a run row's own run, or every run started from a session. */
export function treeRunsOf(runs: Iterable<PipelineRunState>, parentId: string): PipelineRunState[] {
  return [...runs].filter((state) => state.run.id === parentId || state.run.parentSessionId === parentId);
}

/** A run that goes on (it works, waits for you, or goes on at the next start): it is never archived. */
export const runGoesOn = (state: PipelineRunState) => state.run.status === 'running' || state.run.status === 'waiting' || state.run.status === 'paused';

/** The sub-sessions of a tree's runs, once each. */
export function treeSessionCount(runs: readonly PipelineRunState[]): number {
  return new Set(runs.flatMap((state) => state.steps.flatMap((step) => (step.sessionId ? [step.sessionId] : [])))).size;
}

const steps = (count: number) => (count === 1 ? 'its step' : `its ${count} steps`);

/** "Archive with its 4 steps", or "Archive" for a tree without sub-sessions yet. */
export const archiveTreeLabel = (count: number) => (count ? `Archive with ${steps(count)}` : 'Archive');
export const unarchiveTreeLabel = (count: number) => (count ? `Unarchive with ${steps(count)}` : 'Unarchive');

export type RunRowAction = 'open' | 'stop' | 'archive' | 'unarchive' | 'delete';

/**
 * A run row's menu: Open, Stop the run while it works or waits, Archive (or Unarchive) with its steps, and Delete….
 * No Rename, Fork or Run pipeline: a run row isn't a session.
 */
export function runRowMenu(state: PipelineRunState, options: { archived: boolean; sessions: number }): Array<{ action: RunRowAction; label: string }> {
  const going = state.run.status === 'running' || state.run.status === 'waiting';
  return [
    { action: 'open', label: 'Open' },
    ...(going ? [{ action: 'stop' as const, label: 'Stop the run' }] : []),
    options.archived ? { action: 'unarchive' as const, label: unarchiveTreeLabel(options.sessions) } : { action: 'archive' as const, label: archiveTreeLabel(options.sessions) },
    { action: 'delete', label: 'Delete…' },
  ];
}

/**
 * Delete…'s question: what goes away from Switchboard, and that the transcripts stay. `keep`: Keep the sub-sessions is
 * on, so they stay, on their own.
 */
export function deleteTreeText(title: string, sessions: number, parentSession: boolean, keep = false): { title: string; body: string } {
  const short = title.length > 60 ? `${title.slice(0, 59)}…` : title;
  const subs = sessions === 1 ? 'its sub-session' : `its ${sessions} sub-sessions`;
  const head = { title: `Delete “${short}”?` };
  if (keep && sessions) {
    const what = parentSession ? 'This session and its run go' : 'The run goes';
    return { ...head, body: `${what} away from Switchboard. ${sessions === 1 ? 'Its sub-session stays' : `Its ${sessions} sub-sessions stay`}, on their own.` };
  }
  const what = parentSession ? (sessions ? `This session, its run and ${subs} go` : 'This session and its run go') : sessions ? `The run and ${subs} go` : 'The run goes';
  const stay = !parentSession && !sessions ? '' : parentSession && !sessions ? ' Its Claude Code transcript stays on disk.' : ' Their Claude Code transcripts stay on disk.';
  return { ...head, body: `${what} away from Switchboard.${stay}` };
}
