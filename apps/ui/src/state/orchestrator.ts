import { groupWorkers, type CatchUp, type OrchestratorInfo, type OrchestratorWorker, type WorkerState, type WorkerStatus } from '@seshboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { rowStatus, type RowStatus } from './sidebarRows.ts';

// The orchestrator (docs/orchestrator.md) in the window: what the overview above its conversation shows, and which
// session a project's orchestrator is. Pure, so it can be tested; the groups are the protocol's rule (`groupWorkers`).

const STATUS_OF: Record<Exclude<RowStatus, null>, WorkerStatus> = { 'needs-you': 'needsYou', running: 'working', error: 'failed', unread: 'unread', background: 'idle', idle: 'idle' };

/** A started session's state in the overview's words; null while the window doesn't list it yet. */
export const workerStatus = (row: SessionRowData | undefined): WorkerStatus | null => {
  const status = row ? rowStatus(row) : null;
  return status ? STATUS_OF[status] : row ? 'idle' : null;
};

/** One row of the overview. */
export interface OverviewRow {
  worker: OrchestratorWorker;
  /** The session's own title once it has one, else the title its orchestrator gave it. */
  title: string;
  branch: string | null;
  /** What the row says under its title: what it waits for, or what it did. */
  note: string | null;
}

export interface OverviewGroup {
  state: WorkerState;
  label: string;
  rows: OverviewRow[];
}

/** What a session did, or asks, in one line, from its catch-up. */
export function workerNote(state: WorkerState, card: CatchUp | null | undefined): string | null {
  if (state === 'queued') return 'Starts when a slot is free';
  if (!card || state === 'working') return null;
  if (card.state === 'waiting') return card.need.title || card.need.text || null;
  return card.did[0] ?? null;
}

/** The overview: an orchestrator's sessions by group, what needs you first. */
export function overviewGroups(info: Pick<OrchestratorInfo, 'workers'>, rows: ReadonlyMap<string, SessionRowData>, cards: ReadonlyMap<string, CatchUp>): OverviewGroup[] {
  const rowOf = (worker: OrchestratorWorker) => (worker.sessionId ? rows.get(worker.sessionId) : undefined);
  return groupWorkers(info.workers, (worker) => workerStatus(rowOf(worker))).map((group) => ({
    state: group.state,
    label: group.label,
    rows: group.workers.map((worker) => {
      const row = rowOf(worker);
      return { worker, title: worker.title, branch: row?.branch ?? null, note: workerNote(group.state, worker.sessionId ? cards.get(worker.sessionId) : null) };
    }),
  }));
}

/** The orchestrator a session is, or null. */
export const orchestratorInfo = (orchestrators: readonly OrchestratorInfo[], sessionId: string): OrchestratorInfo | null => orchestrators.find((o) => o.sessionId === sessionId) ?? null;

/** The orchestrator that started a session, or null. */
export const orchestratorOfWorker = (orchestrators: readonly OrchestratorInfo[], sessionId: string): OrchestratorInfo | null => orchestrators.find((o) => o.workers.some((w) => w.sessionId === sessionId)) ?? null;

/**
 * A project's orchestrator: the newest one whose session the window still lists (a deleted one is gone), or null.
 */
export function projectOrchestrator(orchestrators: readonly OrchestratorInfo[], projectRoot: string | null, listed: (sessionId: string) => boolean): OrchestratorInfo | null {
  if (!projectRoot) return null;
  return orchestrators.filter((o) => o.projectRoot === projectRoot && listed(o.sessionId)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** An orchestrator's second line in the sidebar: "Orchestrator · 3 sessions · seshboard". */
export function orchestratorRowLine(sessions: number, projectName: string | null): string {
  return ['Orchestrator', sessions === 0 ? 'no sessions yet' : `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`, projectName].filter(Boolean).join(' · ');
}

/**
 * The orchestrator *Go to orchestrator* opens: the open session's project's, or the newest one with no session open.
 * Null when there is none, or the open session is it.
 */
export function goToOrchestrator(orchestrators: readonly OrchestratorInfo[], open: { id: string; projectRoot: string } | null, listed: (sessionId: string) => boolean): string | null {
  const found = open ? projectOrchestrator(orchestrators, open.projectRoot, listed) : (orchestrators.filter((o) => listed(o.sessionId)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);
  return found && found.sessionId !== open?.id ? found.sessionId : null;
}

/** Each session an orchestrator started, with its orchestrator: what the sidebar's tree nests them by. */
export function startedBy(orchestrators: readonly OrchestratorInfo[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of orchestrators) for (const w of o.workers) if (w.sessionId) out.set(w.sessionId, o.sessionId);
  return out;
}

/** The title an orchestrator gave a session it started, or null for any other session. */
export function workerTitle(orchestrators: readonly OrchestratorInfo[], sessionId: string): string | null {
  for (const o of orchestrators) {
    const worker = o.workers.find((w) => w.sessionId === sessionId);
    if (worker) return worker.title;
  }
  return null;
}
