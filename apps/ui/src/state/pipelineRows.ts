import { heldByLabel, runRowId, sidebarTree, type HeldBy, type PipelineRunState, type RunState, type TreeStatus } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { taskTitle } from './pipelines.ts';
import { rowStatus } from './sidebarRows.ts';

// Pipelines (#179) in the sidebar: which sessions nest under which, a parent's rolled-up status and progress line, and
// the rows runs started from New session stand for. Pure, so the sidebar, the rail, ⌃⇥ and ⌘P read the same list.

/** What a parent row says about its run. */
export interface PipelineRowInfo {
  runId: string;
  /** "Validate · 3 of 4", "Done", "Stopped". */
  progress: string;
  state: RunState;
  /** Why the run waits, when it does (a limit, you). */
  wait: string | null;
  /** The most urgent status of the parent and its children: what puts it in Needs you. */
  rolled: TreeStatus;
}

/** A sub-session's place in its run. */
export interface PipelineStepInfo {
  runId: string;
  name: string;
  /** 1-based. */
  number: number;
  total: number;
  round: number;
}

const waitOf = ({ run }: PipelineRunState): string | null => {
  if (run.state !== 'needs-you' && run.state !== 'held') return null;
  const step = run.pipeline.steps[Math.min(run.stepIndex, run.pipeline.steps.length - 1)]?.name ?? 'The step';
  return run.heldBy ? heldByLabel(run.heldBy as HeldBy, step) : run.note;
};

/**
 * Nests sub-sessions under their parents and adds the rows of runs without a session. A parent gets its `children`
 * (step order), its `pipeline` info and, through it, a status rolled up from them; a child gets `depth: 1`, its place in
 * the run (`step`) and the step's name as its title (unless you named it). A child whose parent isn't in the list stays
 * a top-level row. Rows come back as they were when no run or parent is involved.
 */
export function withPipelines(rows: readonly SessionRowData[], runs: readonly PipelineRunState[]): SessionRowData[] {
  if (runs.length === 0 && !rows.some((r) => r.parentId)) return rows as SessionRowData[];
  const local = rows.filter((r) => !r.remote);
  const { parents, childIds } = sidebarTree(
    local.map((r) => ({ id: r.id, parentId: r.parentId, status: rowStatus(r) })),
    runs.map(({ run, steps }) => ({ run, steps })),
  );
  const runById = new Map(runs.map((r) => [r.run.id, r]));
  const byId = new Map(local.map((r) => [r.id, r]));
  const out: SessionRowData[] = [];
  const childRow = (id: string, parentRunId: string | null): SessionRowData | null => {
    const base = byId.get(id);
    if (!base) return null;
    // Which step this session is, from the run it belongs to.
    for (const { run, steps } of runs) {
      const step = steps.find((s) => s.sessionId === id);
      if (!step || (parentRunId !== null && run.id !== parentRunId)) continue;
      const named = base.summary?.customTitle;
      const label = step.round > 1 ? `${step.stepName} (round ${step.round})` : step.stepName;
      return { ...base, depth: 1, title: named ? base.title : label, step: { runId: run.id, name: step.stepName, number: step.stepIndex + 1, total: run.pipeline.steps.length, round: step.round } };
    }
    return { ...base, depth: 1 };
  };
  const parentRow = (base: SessionRowData, parent: ReturnType<typeof parents.get>): SessionRowData => {
    if (!parent) return base;
    const state = parent.runId ? runById.get(parent.runId) : undefined;
    const children = parent.children.flatMap((c) => childRow(c.id, parent.runId) ?? []);
    return {
      ...base,
      ...(children.length ? { children } : {}),
      ...(state ? { pipeline: { runId: state.run.id, progress: parent.progress ?? '', state: state.run.state, wait: waitOf(state), rolled: parent.status } } : children.length ? { pipeline: { runId: '', progress: '', state: 'running' as const, wait: null, rolled: parent.status } } : {}),
    };
  };
  for (const row of rows) {
    if (row.remote) {
      out.push(row);
      continue;
    }
    if (childIds.has(row.id)) continue;
    out.push(parentRow(row, parents.get(row.id)));
  }
  // The rows of runs that have no session of their own.
  for (const [id, parent] of parents) {
    if (!parent.runId || !id.startsWith('run:')) continue;
    const state = runById.get(parent.runId);
    if (!state || out.some((r) => r.id === id)) continue;
    const { run } = state;
    const children = parent.children.flatMap((c) => childRow(c.id, run.id) ?? []);
    out.push({
      id: runRowId(run.id),
      title: taskTitle(run.task),
      projectRoot: run.root,
      updatedAt: run.updatedAt,
      branch: null,
      isWorktree: run.pipeline.workspace === 'worktree',
      live: null,
      summary: null,
      pinned: false,
      archivedAt: null,
      restoredAt: null,
      unread: false,
      inApp: true,
      error: false,
      profileId: run.profileId ?? 'default',
      run: { runId: run.id },
      ...(children.length ? { children } : {}),
      pipeline: { runId: run.id, progress: parent.progress ?? '', state: run.state, wait: waitOf(state), rolled: parent.status },
    });
  }
  return out;
}
