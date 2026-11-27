import type { CompanionStatus } from './companion.ts';
import { groupWorkers, type WorkerState, type WorkerStatus } from './orchestrator.ts';
import type { RemoteOrchestrator, RemotePrompt, RemoteSession } from './remote.ts';

/**
 * The orchestrator's overview on a phone and for another computer (docs/orchestrator.md): the sessions it started, by
 * what needs you first, from what the list says of each. The groups are the computer's own rule (`groupWorkers`).
 * Plain TypeScript, with tests.
 */

const STATUS_OF: Record<CompanionStatus, WorkerStatus> = { 'needs-you': 'needsYou', working: 'working', error: 'failed', unread: 'unread', background: 'idle', idle: 'idle', stopped: 'idle' };

export type RemoteWorker = RemoteOrchestrator['workers'][number];

/** One row of the overview: the title its orchestrator gave it, its branch, and what it asks or waits for. */
export interface RemoteOverviewRow {
  worker: RemoteWorker;
  title: string;
  branch: string | null;
  note: string | null;
}

export interface RemoteOverviewGroup {
  state: WorkerState;
  label: string;
  rows: RemoteOverviewRow[];
}

/** The overview's groups. A started session the list no longer has (archived, out of scope) counts as idle, or ready for review with an open pull request. */
export function remoteOverview(orchestrator: Pick<RemoteOrchestrator, 'workers'>, sessions: readonly Pick<RemoteSession, 'id' | 'status' | 'branch'>[], prompts: readonly Pick<RemotePrompt, 'sessionId' | 'title'>[] = []): RemoteOverviewGroup[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const rowOf = (worker: RemoteWorker) => (worker.sessionId ? byId.get(worker.sessionId) : undefined);
  return groupWorkers(orchestrator.workers, (worker) => {
    const row = rowOf(worker);
    return row ? STATUS_OF[row.status] : worker.sessionId ? 'idle' : null;
  }).map((group) => ({
    state: group.state,
    label: group.label,
    rows: group.workers.map((worker) => ({ worker, title: worker.title, branch: rowOf(worker)?.branch ?? null, note: workerNote(group.state, worker, prompts) })),
  }));
}

/** Under a row's title: a queued start waits for a slot, and one waiting on you says what it asks (its card's title). */
function workerNote(state: WorkerState, worker: RemoteWorker, prompts: readonly Pick<RemotePrompt, 'sessionId' | 'title'>[]): string | null {
  if (state === 'queued') return 'Starts when a slot is free';
  if (state !== 'waiting' || !worker.sessionId) return null;
  return prompts.find((p) => p.sessionId === worker.sessionId)?.title ?? null;
}

/** The orchestrator in a list, by its session's id; null for any other session. */
export const remoteOrchestratorOf = (orchestrators: readonly RemoteOrchestrator[] | undefined, sessionId: string): RemoteOrchestrator | null => orchestrators?.find((o) => o.sessionId === sessionId) ?? null;

/** The orchestrator that started a session, or null. */
export const remoteOrchestratorOfWorker = (orchestrators: readonly RemoteOrchestrator[] | undefined, sessionId: string): RemoteOrchestrator | null => orchestrators?.find((o) => o.workers.some((w) => w.sessionId === sessionId)) ?? null;
