import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ImageAttachment, Pipeline, PipelineRunState, PipelineSave, PushPreview, RunChoices } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

// Pipelines (#179). The engine keeps the pipelines and runs them; every window shows the same runs. The words and
// small rules the views share are in `pipelines.ts`.

interface PipelinesState {
  /** The built-ins, then yours. */
  pipelines: Pipeline[];
  /** Every run, by id. */
  runs: Map<string, PipelineRunState>;
  loaded: boolean;
  /** Runs this window is acting on (a button was pressed), for the buttons' busy state. */
  busy: ReadonlySet<string>;
  /** Push's card, per run, once Haiku has written the message. */
  previews: Map<string, PushPreview>;
  /** The pipeline Settings › Pipelines shows (Pipelines: pick one…, Edit pipelines…); null for the first one. */
  editing: string | null;
  setPipelines(pipelines: Pipeline[]): void;
  setRuns(runs: PipelineRunState[]): void;
  putRun(state: PipelineRunState): void;
  /** A run was deleted (`runs.removed`). */
  dropRun(runId: string): void;
}

export const usePipelines = create<PipelinesState>()((set) => ({
  pipelines: [],
  runs: new Map(),
  loaded: false,
  busy: new Set(),
  previews: new Map(),
  editing: null,
  setPipelines: (pipelines) => set({ pipelines }),
  setRuns: (runs) => set({ runs: new Map(runs.map((r) => [r.run.id, r])), loaded: true }),
  putRun: (state) => set((s) => ({ runs: new Map(s.runs).set(state.run.id, state) })),
  dropRun: (runId) =>
    set((s) => {
      if (!s.runs.has(runId)) return {};
      const runs = new Map(s.runs);
      runs.delete(runId);
      return { runs };
    }),
}));

/** Loads pipelines and runs once per connection and follows changes from every window. */
export function usePipelinesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const offPipelines = client.on('pipelines.changed', ({ pipelines }) => usePipelines.getState().setPipelines(pipelines));
    const offRuns = client.on('runs.changed', ({ state }) => usePipelines.getState().putRun(state));
    const offRemoved = client.on('runs.removed', ({ runId }) => usePipelines.getState().dropRun(runId));
    void client.call('pipelines.list', { root: null }).then(({ pipelines }) => usePipelines.getState().setPipelines(pipelines), () => {});
    void client.call('runs.list', {}).then(({ runs }) => usePipelines.getState().setRuns(runs), () => {});
    return () => {
      offPipelines();
      offRuns();
      offRemoved();
    };
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** The newest run started from a session (or a run row's run, by its id). */
export function runOfParent(runs: ReadonlyMap<string, PipelineRunState>, parentId: string): PipelineRunState | null {
  const direct = runs.get(parentId);
  if (direct) return direct;
  let found: PipelineRunState | null = null;
  for (const state of runs.values()) if (state.run.parentSessionId === parentId && (!found || state.run.createdAt > found.run.createdAt)) found = state;
  return found;
}

/** The run and step a sub-session is. */
export function runOfStep(runs: ReadonlyMap<string, PipelineRunState>, sessionId: string): { state: PipelineRunState; index: number; round: number } | null {
  for (const state of runs.values()) {
    const row = state.steps.findLast((s) => s.sessionId === sessionId);
    if (row) return { state, index: row.index, round: row.round };
  }
  return null;
}

/** The run started from a session (or a run row's), for its view. */
export const useRunOfParent = (parentId: string | null) => usePipelines((s) => (parentId ? runOfParent(s.runs, parentId) : null));
/**
 * The run a sub-session is a step of, with which step. The selector returns the run's own state (the same object until
 * it changes), and the step is worked out from it: a new object from the selector each time would render forever.
 */
export function useRunOfStep(sessionId: string | null): { state: PipelineRunState; index: number; round: number } | null {
  const state = usePipelines((s) => (sessionId ? (runOfStep(s.runs, sessionId)?.state ?? null) : null));
  return useMemo(() => (state && sessionId ? runOfStep(new Map([[state.run.id, state]]), sessionId) : null), [state, sessionId]);
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Marks a run busy while `work` runs, so its buttons show it and a second click does nothing. */
async function withBusy<T>(runId: string, work: () => Promise<T>): Promise<T | null> {
  if (usePipelines.getState().busy.has(runId)) return null;
  const mark = (on: boolean) =>
    usePipelines.setState((s) => {
      const busy = new Set(s.busy);
      if (on) busy.add(runId);
      else busy.delete(runId);
      return { busy };
    });
  mark(true);
  try {
    return await work();
  } finally {
    mark(false);
  }
}

type RunInput = { pipelineId: string; parentSessionId?: string | null; task?: string | null; attachments?: ImageAttachment[]; project?: string | null; profileId?: string | null; choices?: RunChoices | null };

/** Starts a run and keeps it; throws what went wrong (New session shows it where Start's errors go). */
export async function startRun(input: RunInput): Promise<PipelineRunState> {
  const { state } = await clientNow().call('pipelines.run', {
    pipelineId: input.pipelineId,
    parentSessionId: input.parentSessionId ?? null,
    task: input.task ?? null,
    attachments: input.attachments ?? [],
    project: input.project ?? null,
    profileId: input.profileId ?? null,
    choices: input.choices ?? null,
  });
  usePipelines.getState().putRun(state);
  return state;
}

/**
 * Runs a pipeline: from a session (it becomes the parent), or from New session with a task and a project (a run
 * row). Says what went wrong in a toast; the run, else null.
 */
export async function runPipeline(input: RunInput): Promise<PipelineRunState | null> {
  try {
    return await startRun(input);
  } catch (error) {
    toast(`Couldn't run the pipeline: ${describe(error)}`, { data: { 'data-pipeline-error-toast': true } });
    return null;
  }
}

/**
 * Archives or unarchives a run's tree: the parent (a session, or the run row) and its sub-sessions, in one go. Throws
 * what went wrong (a run that still goes on is refused).
 */
export async function archiveRunTree(runId: string, archived: boolean): Promise<void> {
  const { runs } = await clientNow().call('runs.archive', { runId, archived });
  for (const state of runs) usePipelines.getState().putRun(state);
}

/** Deletes a run's tree from Switchboard (stopped first); its sub-sessions stay on their own with `keepSubSessions`. */
export async function deleteRunTree(runId: string, keepSubSessions: boolean): Promise<void> {
  await clientNow().call('runs.delete', { runId, keepSubSessions });
  usePipelines.getState().dropRun(runId);
}

/** Stops a run and waits for it: throws what went wrong. */
export async function stopRunNow(runId: string): Promise<void> {
  const { state } = await clientNow().call('runs.stop', { runId });
  usePipelines.getState().putRun(state);
}

type RunMethod = 'runs.retryStep' | 'runs.anotherRound' | 'runs.skipStep' | 'runs.stop';

async function runCall(runId: string, method: RunMethod, failed: string): Promise<void> {
  await withBusy(runId, async () => {
    try {
      const { state } = await clientNow().call(method, { runId });
      usePipelines.getState().putRun(state);
    } catch (error) {
      toast(`${failed}: ${describe(error)}`);
    }
  });
}

/** Continue: the step that waits for you starts (Push with `message`), or the run goes on after a stop. */
export async function continueRun(runId: string, message: string | null = null): Promise<void> {
  await withBusy(runId, async () => {
    try {
      const { state } = await clientNow().call('runs.continue', { runId, message });
      usePipelines.getState().putRun(state);
    } catch (error) {
      toast(`Couldn't continue: ${describe(error)}`);
    }
  });
}

export const retryStep = (runId: string) => runCall(runId, 'runs.retryStep', 'Couldn’t run this step again');
export const anotherRound = (runId: string) => runCall(runId, 'runs.anotherRound', 'Couldn’t start another round');
export const skipStep = (runId: string) => runCall(runId, 'runs.skipStep', 'Couldn’t skip this step');
export const stopRun = (runId: string) => runCall(runId, 'runs.stop', 'Couldn’t stop the run');

/** Push's commit message and what it pushes, written once per run unless `fresh`. */
export async function loadPushPreview(runId: string, fresh = false): Promise<PushPreview> {
  const kept = usePipelines.getState().previews.get(runId);
  if (kept && !fresh) return kept;
  const { preview } = await clientNow().call('runs.pushPreview', { runId, fresh });
  usePipelines.setState((s) => ({ previews: new Map(s.previews).set(runId, preview) }));
  return preview;
}

/** You wrote in a run row: it gets a session of its own, which the caller opens. */
export async function writeInRun(runId: string, text: string): Promise<string | null> {
  try {
    const { sessionId } = await clientNow().call('runs.write', { runId, text });
    return sessionId;
  } catch (error) {
    toast(`Couldn't send: ${describe(error)}`);
    return null;
  }
}

/** Creates or changes a pipeline. */
export async function savePipeline(pipeline: PipelineSave): Promise<Pipeline> {
  const { pipeline: saved } = await clientNow().call('pipelines.save', { pipeline });
  return saved;
}

/** Deletes without asking; Undo puts it back. */
export async function deletePipeline(pipeline: Pipeline): Promise<void> {
  const client = clientNow();
  await client.call('pipelines.delete', { id: pipeline.id });
  toast(`Deleted ${pipeline.name}`, { undo: () => void client.call('pipelines.restore', { pipeline }).catch(() => {}), data: { 'data-pipeline-deleted-toast': true } });
}

/** Settings › Pipelines, open on a pipeline (or on the list). */
export function openPipelinesSettings(pipelineId: string | null = null): void {
  usePipelines.setState({ editing: pipelineId });
  useSessions.getState().openSettings('pipelines');
}
