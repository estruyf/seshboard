import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { Pipeline, PipelinePushDraft, PipelinePushProgress, PipelineRun, PipelineRunState, PipelineSave, PipelineSaveScope, PipelineScope } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

// Pipelines (#179). The engine keeps the pipelines and runs them; every window shows the same runs, so this follows
// `pipelines.runs` and its events, and loads a project's pipelines when something asks for them.

/** What the Run pipeline dialog opens on: where the run works, its parent session, a task to start from, and the pipeline when it is already chosen. */
export interface RunRequest {
  /** The project's folder: its pipelines are listed. */
  root: string;
  /** Where the run starts from: the session's folder, or the folder picked in New session. */
  cwd: string;
  /** The session that becomes the parent, or null for a run row. */
  parentSessionId: string | null;
  task: string;
  pipeline: Pipeline | null;
  /** The run started: what the opener does next (New session empties its box). */
  onStarted?(): void;
  /** Only choose: a pick closes the dialog and hands the pipeline over, with no task or blanks asked (New session keeps it picked). */
  onChoose?(pipeline: Pipeline): void;
}

/** Opens the dialog that picks a pipeline (when none is chosen yet), asks for its task and blanks, and starts the run. */
export const openRunPipeline = (request: RunRequest) => usePipelines.setState({ runRequest: request });
export const closeRunPipeline = () => usePipelines.setState({ runRequest: null });

/** What the pipeline editor opens on: a pipeline to change (null for a new one) and the project it was opened in. */
export interface PipelineEditorRequest {
  pipeline: Pipeline | null;
  /** The project the editor was opened for (the Settings page's pick, the open session's): where a new one is kept, and whose actions it offers. */
  root: string | null;
  onSaved?(pipeline: Pipeline): void;
}

/** Opens the pipeline editor (Settings › Pipelines, the palette's Edit). */
export const openPipelineEditor = (request: PipelineEditorRequest) => usePipelines.setState({ editor: request });
export const closePipelineEditor = () => usePipelines.setState({ editor: null });
/** Asks whether to delete a pipeline of yours: a dialog answers. */
export const requestDeletePipeline = (pipeline: Pipeline) => usePipelines.setState({ deleting: pipeline });
export const closeDeletePipeline = () => usePipelines.setState({ deleting: null });

export interface PipelineList {
  pipelines: Pipeline[];
  errors: string[];
}

interface PipelinesState {
  /** Every run that is not long over, by id. */
  runs: Map<string, PipelineRunState>;
  /** The pipelines each project (or '' for none) can run: its own, the shared ones, yours and the built-in ones. */
  lists: Map<string, PipelineList>;
  /** How each run's push goes, while it does. */
  push: Map<string, PipelinePushProgress>;
  /** Runs this window is asking the engine about now (Continue, Stop…), for the buttons' busy state. */
  busy: ReadonlySet<string>;
  /** The Run pipeline dialog, open on this. */
  runRequest: RunRequest | null;
  /** The pipeline editor, open on this. */
  editor: PipelineEditorRequest | null;
  /** The pipeline the Delete dialog asks about. */
  deleting: Pipeline | null;
  /** The project Settings › Pipelines lists (its own pipelines and the shared ones); null until picked. */
  settingsRoot: string | null;
  loaded: boolean;
  replaceRuns(runs: readonly PipelineRunState[]): void;
  upsertRun(state: PipelineRunState): void;
}

export const usePipelines = create<PipelinesState>()((set) => ({
  runs: new Map(),
  lists: new Map(),
  push: new Map(),
  busy: new Set(),
  runRequest: null,
  editor: null,
  deleting: null,
  settingsRoot: null,
  loaded: false,
  replaceRuns: (runs) => set({ runs: new Map(runs.map((r) => [r.run.id, r])), loaded: true }),
  upsertRun: (state) => set((s) => ({ runs: new Map(s.runs).set(state.run.id, state) })),
}));

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** The runs as a list, read once. */
export const currentRuns = (): PipelineRunState[] => [...usePipelines.getState().runs.values()];

/** The runs as a list (the same one until a run changes). */
export function useRuns(): PipelineRunState[] {
  const runs = usePipelines((s) => s.runs);
  return useMemo(() => [...runs.values()], [runs]);
}

/** Loads the runs once per connection and follows them, and re-reads the pipeline lists a window has asked for when they change. */
export function usePipelinesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const offRun = client.on('pipelines.runChanged', (state) => usePipelines.getState().upsertRun(state));
    const offList = client.on('pipelines.changed', ({ root }) => {
      for (const key of usePipelines.getState().lists.keys()) if (root === null || key === root || key === '') void loadPipelines(key, true).catch(() => {});
    });
    const offPush = client.on('pipelines.pushProgress', (progress) => {
      usePipelines.setState((s) => ({ push: new Map(s.push).set(progress.runId, progress) }));
      if (progress.step === 'failed') toast(`Couldn’t push: ${progress.error ?? 'unknown reason'}`);
    });
    void client.call('pipelines.runs', {}).then(({ runs }) => usePipelines.getState().replaceRuns(runs), () => {});
    return () => {
      offRun();
      offList();
      offPush();
    };
  }, [client]);
}

/** The pipelines a project can run (its folder, '' for any), read once and again when `pipelines.changed` says so, or when `fresh`. */
export async function loadPipelines(root: string | null, fresh = false): Promise<PipelineList> {
  const key = root ?? '';
  const kept = usePipelines.getState().lists.get(key);
  if (kept && !fresh) return kept;
  const list = await clientNow().call('pipelines.list', root ? { root } : {});
  usePipelines.setState((s) => ({ lists: new Map(s.lists).set(key, list) }));
  return list;
}

/** A project's pipelines for a menu or a picker: loads them on first use. */
export function usePipelineList(root: string | null, enabled = true): PipelineList | null {
  const connected = useEngineConnection().status === 'connected';
  const key = root ?? '';
  const list = usePipelines((s) => s.lists.get(key) ?? null);
  useEffect(() => {
    if (enabled && connected && !list) void loadPipelines(root).catch(() => {});
  }, [enabled, connected, list, root]);
  return list;
}

const fail = (what: string, error: unknown) => toast(`Couldn’t ${what}: ${error instanceof Error ? error.message : String(error)}`);

const mark = (id: string, on: boolean) =>
  usePipelines.setState((s) => {
    const busy = new Set(s.busy);
    if (on) busy.add(id);
    else busy.delete(id);
    return { busy };
  });

/** Runs a call on a run with its busy mark, one at a time; failures are a toast. */
async function onRun(runId: string, what: string, call: () => Promise<{ run: PipelineRun }>): Promise<boolean> {
  const key = `${runId}:${what}`;
  if (usePipelines.getState().busy.has(key)) return false;
  mark(key, true);
  try {
    await call();
    return true;
  } catch (error) {
    fail(what, error);
    return false;
  } finally {
    mark(key, false);
  }
}

export const continueRun = (runId: string) => onRun(runId, 'continue the run', () => clientNow().call('pipelines.continue', { runId }));
export const retryStep = (runId: string) => onRun(runId, 'run the step again', () => clientNow().call('pipelines.retryStep', { runId }));
export const skipStep = (runId: string) => onRun(runId, 'skip the step', () => clientNow().call('pipelines.skipStep', { runId }));
export const stopRun = (runId: string) => onRun(runId, 'stop the run', () => clientNow().call('pipelines.stop', { runId }));
export const trustRun = (runId: string) => onRun(runId, 'start the run', () => clientNow().call('pipelines.trust', { runId }));

/** Whether a call on this run is in flight (the key `continueRun` and the others use is their `what`). */
export const isBusy = (busy: ReadonlySet<string>, runId: string, what: string) => busy.has(`${runId}:${what}`);

/** The Push card's text for a run waiting to push. */
export const pushDraft = (runId: string): Promise<PipelinePushDraft> => clientNow().call('pipelines.pushDraft', { runId });

/** Pushes with the card's text; how it goes comes back as `pipelines.pushProgress`. */
export async function pushRun(runId: string, text: { commitMessage: string | null; prTitle: string | null; prBody: string | null }): Promise<boolean> {
  const going = usePipelines.getState().push.get(runId);
  if (going && ['commit', 'push', 'create'].includes(going.step)) return false;
  usePipelines.setState((s) => ({ push: new Map(s.push).set(runId, { runId, step: 'commit', pr: null, compareUrl: null, error: null }) }));
  try {
    await clientNow().call('pipelines.push', { runId, ...text });
    return true;
  } catch (error) {
    usePipelines.setState((s) => {
      const push = new Map(s.push);
      push.delete(runId);
      return { push };
    });
    fail('push', error);
    return false;
  }
}

/** What starts a run. */
export interface StartRun {
  pipeline: Pick<Pipeline, 'id' | 'scope'>;
  /** The session the run starts from (it becomes the parent), or null for a run row. */
  parentSessionId: string | null;
  cwd: string;
  task: string;
  blanks?: Record<string, string>;
}

/**
 * Starts a run and opens what shows it: the parent session stays where it is (its panel appears), a run row opens in
 * the active pane. A failure is a toast and returns false, so the opener keeps what was typed.
 */
export async function startRun({ pipeline, parentSessionId, cwd, task, blanks }: StartRun): Promise<boolean> {
  try {
    const { run } = await clientNow().call('pipelines.run', { pipelineId: pipeline.id, scope: pipeline.scope as PipelineScope, parentSessionId, cwd, task, blanks: blanks ?? {} });
    usePipelines.getState().upsertRun({ run, steps: usePipelines.getState().runs.get(run.id)?.steps ?? [] });
    useSessions.getState().select(parentSessionId ?? `run:${run.id}`);
    return true;
  } catch (error) {
    fail('start the pipeline', error);
    return false;
  }
}

/** Writes in a run row: a normal session starts in the run's folder and becomes the parent. Returns its id, or null on failure. */
export async function writeToRun(runId: string, text: string): Promise<string | null> {
  try {
    const { sessionId } = await clientNow().call('pipelines.writeToRun', { runId, text, attachments: [] });
    useSessions.getState().select(sessionId);
    return sessionId;
  } catch (error) {
    fail('send the message', error);
    return null;
  }
}

/** The scope a copy of a pipeline is saved in: yours everywhere for a built-in one, where it is for the others. */
const copyScope = (scope: PipelineScope): PipelineSaveScope => (scope.kind === 'builtin' ? { kind: 'global' } : scope);

/** A copy you can change: a built-in pipeline is copied to All projects, the others next to themselves. */
export async function duplicatePipeline(pipeline: Pick<Pipeline, 'id' | 'name' | 'scope'>): Promise<boolean> {
  try {
    const { pipeline: copy } = await clientNow().call('pipelines.duplicate', { id: pipeline.id, scope: pipeline.scope, to: copyScope(pipeline.scope) });
    toast(`Copied to ${copy.name}`, { data: { 'data-pipeline-copied-toast': true } });
    return true;
  } catch (error) {
    fail('copy the pipeline', error);
    return false;
  }
}

/** Deletes one of your pipelines (the Delete dialog confirms first). Throws, so the dialog can say why it failed. */
export async function removePipeline(pipeline: Pipeline): Promise<void> {
  if (pipeline.scope.kind === 'builtin') throw new Error('The built-in pipelines can’t be deleted.');
  await clientNow().call('pipelines.remove', { id: pipeline.id, scope: pipeline.scope });
  toast(`Deleted ${pipeline.name}`, { data: { 'data-pipeline-deleted-toast': true } });
}

/** Saves from the editor. Throws with the engine's reason so the editor can show it. */
export async function savePipeline(pipeline: PipelineSave): Promise<Pipeline> {
  return (await clientNow().call('pipelines.save', { pipeline })).pipeline;
}

/** Moves a pipeline to another scope: a copy there under the same name, then the old one goes. Returns the copy, or null after a toast. */
export async function movePipeline(pipeline: Pipeline, to: PipelineSaveScope, where: string): Promise<Pipeline | null> {
  if (pipeline.scope.kind === 'builtin') return null;
  const client = clientNow();
  try {
    const { pipeline: copy } = await client.call('pipelines.duplicate', { id: pipeline.id, scope: pipeline.scope, to, name: pipeline.name });
    await client.call('pipelines.remove', { id: pipeline.id, scope: pipeline.scope });
    toast(`Moved ${pipeline.name} to ${where}`, { data: { 'data-pipeline-moved-toast': true } });
    return copy;
  } catch (error) {
    fail('move the pipeline', error);
    return null;
  }
}
