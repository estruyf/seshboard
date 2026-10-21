import { runProgress, sidebarTree, stepStateWord, type PipelineRunState, type PipelineStepStatus, type TreeStatus } from '@switchboard/protocol/client';
import { isRunRow, modelWord, modeWord, runIsActive, runTreeStatus } from './pipelines.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { isActive, rowStatus, type RowStatus, type TreeFacts } from './sidebarRows.ts';

// Pipelines (#179) in the sidebar: sub-sessions nest under their parent, a run started from New session is a row of
// its own (a run row), and a parent takes the most urgent state of its own and its children's. A tree goes to Archived
// as one. The open sidebar, the rail and the sidebar's order (⌃⇥, ⌘P) all go through `sidebarForest`, so they never
// disagree. Pure, so it can be tested; the nesting and the parent's state are the protocol's rule (`sidebarTree`).

/** A run row as the sidebar's rows hold it: keyed by the run's id, with no session (yet) behind it. */
export function runRowData(state: PipelineRunState): SessionRowData {
  const { run } = state;
  return {
    id: run.id,
    title: run.title,
    projectRoot: run.projectRoot,
    updatedAt: run.updatedAt,
    workingSince: null,
    branch: null,
    isWorktree: run.cwd !== run.projectRoot,
    live: null,
    summary: null,
    pinned: false,
    archivedAt: run.archivedAt,
    restoredAt: run.restoredAt,
    unread: false,
    inApp: true,
    error: false,
    profileId: run.profileId ?? '',
    remote: null,
  };
}

const TREE_OF: Record<Exclude<RowStatus, null>, TreeStatus> = { 'needs-you': 'needsYou', running: 'working', error: 'failed', unread: 'unread', background: 'idle', idle: 'idle' };
const ROW_OF: Record<TreeStatus, RowStatus> = { needsYou: 'needs-you', working: 'running', failed: 'error', unread: 'unread', idle: null };

/** A row's state in the tree's words. */
export const toTreeStatus = (status: RowStatus): TreeStatus => (status ? TREE_OF[status] : 'idle');

export interface SidebarForest {
  /** What the sidebar lists: sessions without a listed parent, and run rows, each with its state lifted by its children. */
  roots: SessionRowData[];
  /** Each parent's sub-sessions, in step order (rounds after each other). */
  children: Map<string, SessionRowData[]>;
  /** Each sub-session's parent. */
  parentOf: Map<string, string>;
}

/**
 * The sidebar's tree over `rows`: run rows are added, sub-sessions move under their parent (a session, or a run row by
 * its run id), and a parent takes the most urgent state of its own, its children's and its run's (waiting at Push or
 * after a stop counts as needs you). A child whose parent isn't listed shows on its own.
 *
 * A tree is archived as one (`archiveAfterDays`, and Archive on the parent): the parent carries the newest activity in
 * its tree, so it goes to Archived once the whole tree is quiet, never while its run works or waits, and its
 * sub-sessions go with it. A sub-session archived on its own leaves the tree while the parent stays up.
 */
export function sidebarForest(rows: readonly SessionRowData[], runs: Iterable<PipelineRunState>, now: number, archiveAfterDays = Number.POSITIVE_INFINITY): SidebarForest {
  const all = [...runs];
  const runRows = all.filter(isRunRow);
  // A step's session goes under its run's parent before its transcript says so (a session still starting).
  const stepParent = new Map<string, string>();
  for (const { run, steps } of all) for (const step of steps) if (step.sessionId) stepParent.set(step.sessionId, run.parentSessionId ?? run.id);
  const nodes = [...rows, ...runRows.map(runRowData)].map((row) => ({
    id: row.id,
    parentId: row.summary ? (row.summary.parentId ?? null) : (stepParent.get(row.id) ?? null),
    status: toTreeStatus(rowStatus(row)),
    createdAt: row.summary?.createdAt ?? null,
    row,
  }));
  const tree = sidebarTree(nodes, all, runTreeStatus);
  const lift = (row: SessionRowData, kids: readonly SessionRowData[] = []): SessionRowData => {
    const status = tree.status.get(row.id);
    // The tree's newest activity: what its listing (and Archive's "until new activity") goes by.
    const updatedAt = Math.max(row.updatedAt, ...kids.map((kid) => kid.updatedAt));
    const own = rowStatus(row);
    // Idle children leave the parent as it is (a background task, say).
    const lifted = !status || status === 'idle' ? own : ROW_OF[status];
    if (lifted === own && updatedAt === row.updatedAt) return row;
    const parent: SessionRowData & TreeFacts = { ...row, updatedAt, ...(lifted !== own ? { treeStatus: lifted } : {}) };
    return parent;
  };
  const children = new Map<string, SessionRowData[]>();
  const parentOf = new Map<string, string>();
  const roots: SessionRowData[] = [];
  /** Sub-sessions archived by hand under a parent that stays up: they leave the tree, for Archived. */
  const left: SessionRowData[] = [];
  const liftAll = (node: { id: string; row: SessionRowData }): SessionRowData => {
    const kids = tree.children.get(node.id);
    if (!kids) return lift(node.row);
    const rows = kids.map(liftAll);
    const parent = lift(node.row, rows);
    const up = isActive(parent, now, archiveAfterDays);
    const stay = up ? rows.filter((kid) => isActive(kid, now, Number.POSITIVE_INFINITY)) : rows;
    if (stay.length !== rows.length) left.push(...rows.filter((kid) => !stay.includes(kid)));
    if (stay.length) {
      children.set(node.id, stay);
      for (const kid of stay) parentOf.set(kid.id, node.id);
    }
    return parent;
  };
  for (const node of tree.roots) roots.push(liftAll(node));
  return { roots: [...roots, ...left], children, parentOf };
}

/** The run and round a sub-session is, from the runs. */
export function stepOfSession(runs: Iterable<PipelineRunState>, sessionId: string): { state: PipelineRunState; row: PipelineRunState['steps'][number] } | null {
  for (const state of runs) {
    const row = state.steps.findLast((s) => s.sessionId === sessionId);
    if (row) return { state, row };
  }
  return null;
}

const clean = (text: string | null | undefined) => (text ? text.trim().replace(/\.$/, '') : null) || null;

/**
 * A sub-session's second line: the step's model, then how it started or its mode while it works, then its state or
 * what it did. "Opus · plan approved", "Sonnet · fork of Plan · working", "Opus · read only · working".
 */
export function stepMeta(state: PipelineRunState, row: PipelineRunState['steps'][number]): string {
  const step = state.run.pipeline.steps[row.index];
  const going = row.status === 'working' || row.status === 'waiting';
  const parts: Array<string | null> = [];
  if (step?.kind === 'claude') {
    parts.push(modelWord(step.model));
    parts.push(typeof step.start === 'object' ? `fork of ${step.start.fork}` : going ? modeWord(step) : null);
  }
  const verdict = row.verdict ? (row.verdict.kind === 'pass' ? 'pass' : 'changes needed') : null;
  parts.push(going ? stepStateWord(row.status) : (verdict ?? clean(row.reason) ?? stepStateWord(row.status)));
  return parts.filter(Boolean).join(' · ');
}

/** A sub-session's dot: its session's state first (it asks, works, failed, is unread), else its step's. */
export type ChildTone = 'needs-you' | 'working' | 'done' | 'failed' | 'unread' | 'idle';

export function childTone(status: RowStatus, step: PipelineStepStatus | null): ChildTone {
  if (status === 'needs-you') return 'needs-you';
  if (status === 'running') return 'working';
  if (status === 'error') return 'failed';
  if (status === 'unread') return 'unread';
  if (step === 'waiting') return 'needs-you';
  if (step === 'working') return 'working';
  if (step === 'done') return 'done';
  if (step === 'failed') return 'failed';
  return 'idle';
}

/** What a waiting sub-session asks, after its name: "asks a question", "asks to use Bash". */
export function asksWords(toolName: string | null): string {
  if (toolName === null) return 'waits for you';
  if (toolName === 'AskUserQuestion') return 'asks a question';
  if (toolName === 'ExitPlanMode') return 'has a plan to review';
  return `asks to use ${toolName}`;
}

/**
 * A parent's second line when its run needs you: which sub-session asks what, or why the run waits. "Needs you ·
 * Execute asks a question", "Needs you · Push waits for you".
 */
export function treeNeedsYouLine(state: PipelineRunState | null, waitingChild: { title: string; toolName: string | null } | null): string {
  if (waitingChild) return `Needs you · ${waitingChild.title} ${asksWords(waitingChild.toolName)}`;
  const run = state?.run;
  if (!run || run.status !== 'waiting') return 'Needs you';
  if (run.waitingFor === 'push') return 'Needs you · Push waits for you';
  const reason = clean(run.reason);
  if (reason) return `Needs you · ${reason}`;
  const step = run.pipeline.steps[run.sentBackTo ?? run.step];
  return step ? `Needs you · ${step.name} waits for you` : 'Needs you';
}

/** A parent's second line while its run counts: "Validate · 3 of 4 · switchboard" (no project with the filter on). */
export const parentRunLine = (state: PipelineRunState, project: string | null) => [runProgress(state.run), project].filter(Boolean).join(' · ');

/** A run row's second line: "Run · Plan · 1 of 4 · switchboard". */
export const runRowLine = (state: PipelineRunState, project: string | null) => ['Run', runProgress(state.run), project].filter(Boolean).join(' · ');

/** The footer's "1 pipeline running": runs that go on, or null when none do. */
export function pipelinesRunning(runs: Iterable<PipelineRunState>): string | null {
  let count = 0;
  for (const state of runs) if (runIsActive(state)) count++;
  return count ? `${count} ${count === 1 ? 'pipeline' : 'pipelines'} running` : null;
}
