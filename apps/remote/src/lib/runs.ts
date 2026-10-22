import {
  childMeta,
  parentRunLine,
  runIsActive,
  runOfParent,
  runOfStep,
  runRowLine,
  runTreeStatus,
  sidebarTree,
  treeNeedsYouLine,
  type CompanionStatus,
  type RemoteRunState,
  type RemoteSessions,
  type TreeStatus,
} from '@switchboard/protocol/remote-client';
import type { ListedPrompt, ListedRun, ListedSession } from './everywhere.ts';

/**
 * Pipelines (#179) on a phone, as Switchboard's sidebar has them: a step's sub-session sits under the session the run
 * started from (or under its run row), and a parent takes the most urgent state of its own, its children's and its
 * run's. The rules are the protocol's (`sidebarTree`, `pipelineView.ts`), so a run reads the same on the computer.
 * Pure, with tests.
 */

const TREE_OF: Record<CompanionStatus, TreeStatus> = { 'needs-you': 'needsYou', working: 'working', error: 'failed', unread: 'unread', background: 'idle', idle: 'idle', stopped: 'idle' };
const STATUS_OF: Record<Exclude<TreeStatus, 'idle'>, CompanionStatus> = { needsYou: 'needs-you', working: 'working', failed: 'error', unread: 'unread' };

export interface ListTree {
  /** What the list shows: sessions without a listed parent and run rows, each with the state its tree lifts it to. */
  roots: ListedSession[];
  /** Each parent's sub-sessions by the parent's key, in step order (rounds after each other). */
  children: Map<string, ListedSession[]>;
}

/**
 * The list as a tree, per computer (a session's `parentId` is its computer's own id). A parent's `status` is the most
 * urgent of its own and its tree's (a child that needs you makes it Needs you), and its `updatedAt` the newest in its
 * tree, so it sorts where its tree's news is. A child whose parent isn't listed shows on its own.
 */
export function listTree(sessions: readonly ListedSession[], runs: readonly ListedRun[]): ListTree {
  const roots: ListedSession[] = [];
  const children = new Map<string, ListedSession[]>();
  const computers = [...new Set(sessions.map((s) => s.computer))];
  for (const computer of computers) {
    const rows = sessions.filter((s) => s.computer === computer).map((row) => ({ id: row.sessionId, parentId: row.parentId ?? null, status: TREE_OF[row.status], row }));
    const tree = sidebarTree(rows, runs.filter((r) => r.computer === computer), runTreeStatus);
    for (const node of tree.roots) {
      const kids = (tree.children.get(node.id) ?? []).map((kid) => kid.row);
      const lifted = tree.status.get(node.id);
      const status = lifted && lifted !== 'idle' ? STATUS_OF[lifted] : node.row.status;
      const updatedAt = Math.max(node.row.updatedAt, ...kids.map((kid) => kid.updatedAt));
      roots.push(status === node.row.status && updatedAt === node.row.updatedAt ? node.row : { ...node.row, status, updatedAt });
      if (kids.length) children.set(node.row.id, kids);
    }
  }
  return { roots, children };
}

/** A computer's run of a session: the run it started (or a run row's own), and the run and step it is a sub-session of. */
export function runsOf(list: Pick<RemoteSessions, 'runs'>, sessionId: string): { parent: RemoteRunState | null; step: { state: RemoteRunState; index: number; round: number } | null } {
  const runs = list.runs ?? [];
  const parent = runOfParent(runs, sessionId);
  return { parent: parent && (parent.run.parentSessionId ?? parent.run.id) === sessionId ? parent : null, step: runOfStep(runs, sessionId) };
}

/** The run of a row in the list: a run row's, or the newest started from that session. */
export function runOfRow(runs: readonly ListedRun[], row: Pick<ListedSession, 'id'>): ListedRun | null {
  let found: ListedRun | null = null;
  for (const state of runs) if (state.parent === row.id && (!found || state.run.createdAt > found.run.createdAt)) found = state;
  return found;
}

/**
 * A parent's or a run row's second line while its run counts, after the computer and profile: why it needs you
 * ("Needs you · Execute asks a question"), else where the run is ("Validate · 3 of 4 · Web", "Run · Plan · 1 of 4 ·
 * Web"). Null for a parent whose run is over: it reads as any session then.
 */
export function treeLine(row: ListedSession, run: ListedRun | null, kids: readonly ListedSession[], prompts: readonly ListedPrompt[]): string | null {
  if (!run) return null;
  if (row.status === 'needs-you') {
    const waiting = kids.find((kid) => kid.status === 'needs-you');
    const asks = waiting ? prompts.filter((p) => p.sessionId === waiting.id).sort((a, b) => a.createdAt - b.createdAt)[0] : undefined;
    // The run itself waits (Push, Wait for me) when no sub-session asks.
    if (waiting || run.run.status === 'waiting') return treeNeedsYouLine(run, waiting ? { title: waiting.title, toolName: asks?.toolName ?? null } : null);
  }
  if (row.runRow) return runRowLine(run, row.projectName);
  return runIsActive(run) ? parentRunLine(run, row.projectName) : null;
}

/** A sub-session's dot: its session's state first (it asks, works, failed), else its step's. A step the run finished is done. */
export type ChildTone = 'needs-you' | 'working' | 'done' | 'failed' | 'unread' | 'idle';

export function childTone(status: CompanionStatus, step: RemoteRunState['steps'][number]['status'] | null): ChildTone {
  if (status === 'needs-you' || step === 'waiting') return 'needs-you';
  if (status === 'working' || step === 'working') return 'working';
  if (status === 'error' || step === 'failed') return 'failed';
  if (step === 'done') return 'done';
  if (status === 'unread') return 'unread';
  return 'idle';
}

/** A sub-session's line in the list: "Opus · plan approved", "Sonnet · fork of Plan · working". */
export function childLine(runs: readonly ListedRun[], kid: ListedSession): { tone: ChildTone; line: string | null } {
  const step = runOfStep(
    runs.filter((r) => r.computer === kid.computer),
    kid.sessionId,
  );
  const row = step ? (step.state.steps.findLast((s) => s.sessionId === kid.sessionId) ?? null) : null;
  return { tone: childTone(kid.status, row?.status ?? null), line: step && row ? childMeta(step.state, row) : null };
}

/** The trees opened in the list, for this tab: closed by default, as in the sidebar. */
const OPEN_TREES = 'switchboard-remote:open-trees';

export function openTrees(): Set<string> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(OPEN_TREES) ?? '[]') as unknown;
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function keepOpenTrees(open: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(OPEN_TREES, JSON.stringify([...open]));
  } catch {
    // Private browsing without storage: the trees stay as they are until the page closes.
  }
}

/** The pipeline this device last ran in a project on a computer, first in Run as. Not secret: localStorage. */
const LAST_PIPELINE = 'switchboard-remote:last-pipeline';

export function lastPipeline(computer: string, projectId: string): string | null {
  try {
    return localStorage.getItem(`${LAST_PIPELINE}:${computer}:${projectId}`);
  } catch {
    return null;
  }
}

export function rememberPipeline(computer: string, projectId: string, pipelineId: string): void {
  try {
    localStorage.setItem(`${LAST_PIPELINE}:${computer}:${projectId}`, pipelineId);
  } catch {
    // Private browsing without storage: Run as lists the built-ins first.
  }
}
