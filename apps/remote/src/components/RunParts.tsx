import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleStop, CircleX, Clock, GitFork, GitPullRequestArrow, ListTree, LoaderCircle, Play, Repeat, RotateCcw, SkipForward, Square, TriangleAlert } from 'lucide-react';
import {
  currentIndex,
  holdLine,
  pipelineMeta,
  pushLine,
  READ_ONLY_LINE,
  roundDivider,
  runButtons,
  runHeaderLine,
  runProgress,
  stepDetail,
  stepDuration,
  stepLabel,
  stepMeta,
  stepPills,
  stepPlace,
  stepRowName,
  stepView,
  stopNotice,
  waitsForPush,
  waitsOnStep,
  type PushPreview,
  type RemotePipeline,
  type RemoteRunState,
  type StepView,
  type StopNotice,
} from '@switchboard/protocol/remote-client';
import type { Client } from './Connected.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toasts.tsx';
import { Button } from './ui.tsx';

// Pipelines (#179) on a phone: the run's step tree with its buttons, Push's card, the bar a run's parent and its
// sub-sessions show under their header, and Run pipeline…. The words are the protocol's (`pipelineView.ts`), the same
// as on the computer; a run belongs to the computer it started on, and every button asks it.

const lostConnection = (error: unknown) => (error as { code?: string }).code === 'DISCONNECTED';

/** The time, every 30 seconds while `active`, so a running step's duration moves. */
function useTicking(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type RunMethod = 'runs.retryStep' | 'runs.anotherRound' | 'runs.skipStep' | 'runs.stop';

/**
 * A run's buttons on its computer: busy while one is asked (the buttons show it, a second press does nothing), and
 * what went wrong in a toast, in the computer's words ("This run has ended."). The list follows with the new state.
 */
export function useRunActions(client: Client, runId: string) {
  const [busy, setBusy] = useState(false);
  const act = async (work: (client: NonNullable<Client>) => Promise<unknown>, failed: string) => {
    if (!client || busy) return false;
    setBusy(true);
    try {
      await work(client);
      return true;
    } catch (error) {
      toast(lostConnection(error) ? "That didn't reach your computer." : `${failed}: ${(error as Error).message}`, { tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const call = (method: RunMethod, failed: string) => act((c) => c.call(method, { runId }), failed);
  return {
    busy,
    continue: (message?: string) => act((c) => c.call('runs.continue', { runId, ...(message ? { message } : {}) }), 'Couldn’t continue'),
    retry: () => call('runs.retryStep', 'Couldn’t run this step again'),
    anotherRound: () => call('runs.anotherRound', 'Couldn’t start another round'),
    skip: () => call('runs.skipStep', 'Couldn’t skip this step'),
    stop: () => call('runs.stop', 'Couldn’t stop the run'),
  };
}

/** A step's state as an icon: done, working, needs you, waiting, failed, skipped or stopped. */
export function StepIcon({ view, className = 'size-4' }: { view: StepView; className?: string }) {
  switch (view) {
    case 'done':
      return <CircleCheck className={`${className} shrink-0 text-ok`} aria-hidden />;
    case 'working':
      return <LoaderCircle className={`${className} shrink-0 animate-spin text-accent-ink`} aria-hidden />;
    case 'needsYou':
      return <CircleAlert className={`${className} shrink-0 animate-pulse text-warn`} aria-hidden />;
    case 'failed':
      return <CircleX className={`${className} shrink-0 text-error`} aria-hidden />;
    case 'skipped':
      return <CircleMinus className={`${className} shrink-0 text-faint`} aria-hidden />;
    case 'stopped':
      return <CircleStop className={`${className} shrink-0 text-muted`} aria-hidden />;
    default:
      return <CircleDashed className={`${className} shrink-0 text-faint`} aria-hidden />;
  }
}

const NOTICE_TONE: Record<StopNotice['kind'], string> = { stop: 'bg-caution/10 text-caution', paused: 'bg-sidebar text-muted', confirm: 'bg-link/10 text-link' };

/** A run's stop: what happened and what to do, on the step tree and in the step it stopped at. */
export function RunStopNotice({ notice, actions, className = '' }: { notice: StopNotice; actions?: ReactNode; className?: string }) {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-ui ${NOTICE_TONE[notice.kind]} ${className}`} data-remote-run-stop={notice.kind}>
      {notice.kind === 'paused' ? <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-text">{notice.title}</span>
        {notice.advice && <span className="text-meta text-muted">{notice.advice}</span>}
      </span>
      {actions}
    </div>
  );
}

/**
 * The step tree (#179): the pipeline, where the run is and how long it has taken, its pull request, the run's buttons,
 * then each step with its state, model and mode, its pills, what it did, how long it took and Open. The step the run
 * is at has the accent frame, and Push's card sits in its place while the run waits for it. `canOpen` says which
 * sub-sessions the phone lists (an archived one can't be opened from here).
 */
export function StepTree({ state, client, canOpen, onOpenStep, className = '' }: { state: RemoteRunState; client: Client; canOpen: (sessionId: string) => boolean; onOpenStep: (sessionId: string) => void; className?: string }) {
  const { run } = state;
  const now = useTicking(run.status === 'running' || run.status === 'waiting');
  const actions = useRunActions(client, run.id);
  const buttons = runButtons(state);
  const notice = stopNotice(state);
  const hold = holdLine(run);
  const current = currentIndex(state);
  const off = !client || actions.busy;
  return (
    <section className={`rounded-xl border border-border bg-card px-3 py-3 sm:px-4 ${className}`} aria-label={`${run.pipeline.name} run`} data-remote-pipeline-tree={run.id} data-remote-run-status={run.status}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ListTree className="size-4 shrink-0 text-pipeline" aria-hidden />
        <h2 className="min-w-0 truncate text-ui font-semibold text-text">{run.pipeline.name}</h2>
        <span className="shrink-0 text-meta text-muted tabular-nums" data-remote-run-progress>
          {run.status === 'done' ? `done · ${runHeaderLine(state, now).split(' · ').at(-1)}` : run.status === 'stopped' ? 'stopped' : runHeaderLine(state, now)}
        </span>
        {run.pr && /^https:\/\//.test(run.pr.url) && (
          <a href={run.pr.url} target="_blank" rel="noreferrer noopener" className="rounded-full bg-link/10 px-2 text-meta font-medium text-link hover:underline" data-remote-run-pr>
            #{run.pr.number}
          </a>
        )}
        {actions.busy && <LoaderCircle className="ml-auto size-3.5 animate-spin text-accent-ink" aria-label="Working on it" />}
      </div>
      {notice && <RunStopNotice notice={notice} className="mt-2.5" />}
      {hold && (
        <p className="mt-2 flex items-center gap-1.5 text-meta text-muted" role="status" data-remote-run-hold={run.hold}>
          <Clock className="size-3" aria-hidden />
          {hold}
        </p>
      )}
      {(buttons.anotherRound || buttons.continue || buttons.skip || buttons.retry || buttons.stop) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-busy={actions.busy || undefined}>
          {buttons.anotherRound && (
            <Button variant="primary" size="md" disabled={off} onClick={() => void actions.anotherRound()} data-remote-run-another-round>
              <Repeat className="size-3.5" aria-hidden />
              Another round
            </Button>
          )}
          {buttons.continue && (
            <Button variant={buttons.anotherRound ? 'secondary' : 'primary'} size="md" disabled={off} onClick={() => void actions.continue()} data-remote-run-continue>
              <Play className="size-3.5" aria-hidden />
              Continue
            </Button>
          )}
          {buttons.skip && (
            <Button size="md" disabled={off} onClick={() => void actions.skip()} data-remote-run-skip>
              <SkipForward className="size-3.5" aria-hidden />
              Skip this step
            </Button>
          )}
          {buttons.retry && (
            <Button size="md" disabled={off} onClick={() => void actions.retry()} data-remote-run-retry>
              <RotateCcw className="size-3.5" aria-hidden />
              Run this step again
            </Button>
          )}
          {buttons.stop && (
            <Button variant="danger" size="md" disabled={off} onClick={() => void actions.stop()} data-remote-run-stop-button>
              <Square className="size-3 fill-current" aria-hidden />
              Stop the run
            </Button>
          )}
        </div>
      )}
      <ol className="mt-2 flex flex-col gap-0.5" aria-label="Steps">
        {run.pipeline.steps.map((step, index) =>
          step.kind === 'push' && waitsForPush(state) && run.step === index ? (
            <li key={index} className="py-1" aria-label={stepLabel(state, index)} data-remote-pipeline-step={step.name}>
              <PushCard state={state} client={client} />
            </li>
          ) : (
            <StepRow key={index} state={state} index={index} current={index === current} now={now} canOpen={canOpen} onOpen={onOpenStep} />
          ),
        )}
      </ol>
    </section>
  );
}

function StepRow({ state, index, current, now, canOpen, onOpen }: { state: RemoteRunState; index: number; current: boolean; now: number; canOpen: (sessionId: string) => boolean; onOpen: (sessionId: string) => void }) {
  const step = state.run.pipeline.steps[index]!;
  const { view, row } = stepView(state, index);
  const detail = stepDetail(state, index);
  const duration = stepDuration(row, now);
  const sessionId = row?.sessionId ?? null;
  return (
    <li
      className={`flex min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-1.5 ${current ? 'border-accent-ink/60 bg-accent/10' : 'border-transparent'}`}
      aria-label={stepLabel(state, index)}
      aria-current={current ? 'step' : undefined}
      data-remote-pipeline-step={step.name}
      data-remote-step-view={view}
    >
      <span className="flex h-5 items-center">
        <StepIcon view={view} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-ui font-semibold text-text">{stepRowName(step, row)}</span>
          <span className="min-w-0 truncate text-meta text-muted">{stepMeta(step)}</span>
          {stepPills(step, row).map((pill) =>
            pill.kind === 'round' ? (
              <span key={pill.kind} className="rounded-full bg-accent/15 px-1.5 text-meta font-medium text-accent-ink">
                {pill.text}
              </span>
            ) : (
              <span key={pill.kind} className="inline-flex items-center gap-1 rounded-full bg-pipeline/15 px-1.5 text-meta font-medium text-pipeline">
                {pill.kind === 'fork' && <GitFork className="size-2.5" aria-hidden />}
                {pill.text}
              </span>
            ),
          )}
        </div>
        {detail && <p className={`mt-0.5 text-meta [overflow-wrap:anywhere] ${view === 'failed' ? 'text-error' : view === 'needsYou' ? 'text-warn' : 'text-muted'}`}>{detail}</p>}
      </div>
      <span className="flex min-h-5 shrink-0 items-center gap-2">
        {duration && <span className="text-meta text-muted tabular-nums">{duration}</span>}
        {sessionId && canOpen(sessionId) && (
          <Button variant="quiet" size="md" onClick={() => onOpen(sessionId)} aria-label={`Open ${stepRowName(step, row)}`} className="-my-2 -mr-1 px-2! text-link!" data-remote-step-open={sessionId}>
            Open
          </Button>
        )}
      </span>
    </li>
  );
}

/**
 * Push, while the run waits for it: the commit message Haiku wrote from the diff, what it commits and where it goes,
 * then Commit, push and open PR. Edit message makes the message editable first; Stop here ends the run.
 */
export function PushCard({ state, client }: { state: RemoteRunState; client: Client }) {
  const { run } = state;
  const step = run.pipeline.steps[run.step];
  const actions = useRunActions(client, run.id);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [pushing, setPushing] = useState(false);
  const messageId = useId();
  const load = (fresh: boolean) => {
    if (!client) return;
    setPreview(null);
    setError(null);
    void client.call('runs.pushPreview', { runId: run.id, fresh }).then(
      ({ preview }) => {
        setPreview(preview);
        setMessage(preview.message);
      },
      (e: Error) => setError(lostConnection(e) ? "That didn't reach your computer." : e.message),
    );
  };
  // Once per run: the computer keeps the message after that.
  useEffect(() => load(false), [client, run.id]);
  const loading = preview === null && error === null;
  const push = async () => {
    setPushing(true);
    try {
      await actions.continue(message.trim() || undefined);
    } finally {
      setPushing(false);
    }
  };
  const blocked = !client || loading || actions.busy || Boolean(preview?.problem) || !message.trim();
  return (
    <div className="rounded-xl border border-accent-ink/60 bg-accent/5 px-3 py-3" data-remote-push-card={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <GitPullRequestArrow className="size-3.5 shrink-0 text-text" aria-hidden />
        <span className="text-ui font-semibold text-text">{step?.name ?? 'Push'}</span>
        <span className="rounded-full bg-accent/15 px-1.5 text-meta font-medium text-accent-ink">waits for you</span>
        {step?.kind === 'push' && step.draft && <span className="text-meta text-muted">opens a draft</span>}
      </div>
      {loading ? (
        <p className="mt-2 flex items-center gap-1.5 text-ui text-muted" role="status" data-remote-push-loading>
          <LoaderCircle className="size-3.5 animate-spin text-accent-ink" aria-hidden />
          Writing the message…
        </p>
      ) : error ? (
        <div role="alert" className="mt-2 flex items-center gap-2 rounded-lg bg-error/10 px-3 py-2 text-ui text-error">
          <span className="flex-1">Couldn’t write the message: {error}</span>
          <Button variant="quiet" size="md" onClick={() => load(true)} className="-my-1 px-2! text-error!">
            Try again
          </Button>
        </div>
      ) : (
        <>
          {editing ? (
            <>
              <label htmlFor={messageId} className="sr-only">
                Commit message
              </label>
              <textarea
                id={messageId}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={Math.min(8, Math.max(3, message.split('\n').length))}
                className="field mt-2 w-full resize-y px-2.5 py-1.5 font-mono text-ui text-text"
                autoFocus
                data-remote-push-message-input
              />
            </>
          ) : (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-code px-2.5 py-1.5 font-mono text-ui whitespace-pre-wrap text-text [overflow-wrap:anywhere]" data-remote-push-message>
              {message || 'No message'}
            </pre>
          )}
          {preview && <p className="mt-1.5 truncate text-meta text-muted">{pushLine(preview)} · message by Haiku from the diff</p>}
          {preview?.problem && <p className="mt-2 rounded-lg bg-caution/10 px-3 py-2 text-ui text-caution">{preview.problem}</p>}
        </>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button variant="primary" disabled={blocked || pushing} aria-busy={pushing || undefined} onClick={() => void push()} className="w-full sm:w-auto" data-remote-push-confirm>
          {pushing && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
          {pushing ? 'Pushing…' : 'Commit, push and open PR'}
        </Button>
        {!editing && (
          <Button disabled={loading || Boolean(error)} onClick={() => setEditing(true)} data-remote-push-edit>
            Edit message
          </Button>
        )}
        <Button disabled={!client || actions.busy || pushing} onClick={() => void actions.stop()} data-remote-push-stop>
          Stop here
        </Button>
      </div>
    </div>
  );
}

/**
 * The run under the header of a session it belongs to: in its parent, the pipeline and where the run is; in a step's
 * sub-session, which step this is with Back to the run. The run's stop, Push or a hold is the second line. A tap opens
 * the step tree in a sheet; the one thing the run waits for (Continue, Another round, Push) is a button right here.
 */
export function RunBar({ state, step, client, onSteps, onParent }: { state: RemoteRunState; /** This is a step's sub-session. */ step: { index: number; round: number } | null; client: Client; onSteps: () => void; onParent: (() => void) | null }) {
  const { run } = state;
  const actions = useRunActions(client, run.id);
  const buttons = runButtons(state);
  const notice = stopNotice(state);
  // In a step, its stop only shows in the step the run waits on; elsewhere the run's place does.
  const here = step ? waitsOnStep(state, step.index, step.round) : true;
  const second = waitsForPush(state) ? 'Push waits for you' : here && notice ? notice.title : holdLine(run);
  const needsYou = run.status === 'waiting' && here;
  const own = step ? run.pipeline.steps[step.index] : undefined;
  // A step's own facts when nothing else needs saying: it can't edit, and its round ("Round 2 · started 14:21").
  const facts = [own?.kind === 'claude' && own.readOnly ? 'Read only' : null, step ? roundDivider(state, step.index, step.round) : null].filter(Boolean).join(' · ');
  return (
    <div className="border-b border-border bg-sidebar px-3 py-1.5 sm:px-6" data-remote-run-bar={run.id}>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
        {step && onParent && (
          <Button variant="quiet" size="md" onClick={onParent} aria-label="Back to the run" title="Back to the run" className="-ml-1 px-2!" data-remote-back-to-run>
            <ArrowUp className="size-4" aria-hidden />
          </Button>
        )}
        <button type="button" onClick={onSteps} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left pointer-fine:min-h-8" aria-label={`${run.pipeline.name}: show the steps`} data-remote-run-steps>
          <ListTree className="size-4 shrink-0 text-pipeline" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui text-text">
              {step ? (
                <>
                  <span className="font-semibold">{stepPlace(state, step.index, step.round)}</span>
                  <span className="text-muted"> · {run.pipeline.name}</span>
                </>
              ) : (
                <>
                  <span className="font-semibold">{run.pipeline.name}</span>
                  <span className="text-muted"> · {run.status === 'stopped' ? 'stopped' : runProgress(run)}</span>
                </>
              )}
            </span>
            {second ? (
              <span className={`block truncate text-meta ${needsYou ? 'text-warn' : 'text-muted'}`}>{second}</span>
            ) : (
              facts && (
                <span className="block truncate text-meta text-muted" title={own?.kind === 'claude' && own.readOnly ? READ_ONLY_LINE : undefined}>
                  {facts}
                </span>
              )
            )}
          </span>
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </button>
        {waitsForPush(state) ? (
          <Button variant="primary" size="md" onClick={onSteps} data-remote-run-push>
            Push…
          </Button>
        ) : buttons.anotherRound && here ? (
          <Button variant="primary" size="md" disabled={!client || actions.busy} aria-busy={actions.busy || undefined} onClick={() => void actions.anotherRound()} data-remote-run-another-round>
            {actions.busy ? 'Sending…' : 'Another round'}
          </Button>
        ) : buttons.continue && here ? (
          <Button variant="primary" size="md" disabled={!client || actions.busy} aria-busy={actions.busy || undefined} onClick={() => void actions.continue()} data-remote-run-continue>
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The step tree in a sheet, from a run's bar. */
export function RunSheet({ state, client, canOpen, onOpenStep, onClose }: { state: RemoteRunState; client: Client; canOpen: (sessionId: string) => boolean; onOpenStep: (sessionId: string) => void; onClose: () => void }) {
  return (
    <Sheet title={state.run.title} subtitle={state.run.projectName} onClose={onClose} hook="run">
      <StepTree
        state={state}
        client={client}
        canOpen={canOpen}
        onOpenStep={(sessionId) => {
          onClose();
          onOpenStep(sessionId);
        }}
      />
    </Sheet>
  );
}

/**
 * Run pipeline…, from a session's menu: the pipelines its project can run there, each with what its steps use. A tap
 * runs it with this session as the parent; making the run's worktree can take a moment, so the row says it starts.
 */
export function RunPipelineSheet({ client, projectId, sessionId, onClose }: { client: Client; projectId: string; sessionId: string; onClose: () => void }) {
  const [pipelines, setPipelines] = useState<RemotePipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void client.call('pipelines.list', { projectId }).then(
      (result) => live && setPipelines(result.pipelines),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [client, projectId]);
  const run = async (pipeline: RemotePipeline) => {
    if (!client || starting) return;
    setStarting(pipeline.id);
    setError(null);
    try {
      await client.call('pipelines.run', { pipelineId: pipeline.id, parentSessionId: sessionId });
      toast(`Started ${pipeline.name}`);
      onClose();
    } catch (e) {
      setError(lostConnection(e) ? "That didn't reach your computer." : (e as Error).message);
      setStarting(null);
    }
  };
  return (
    <Sheet title="Run pipeline" subtitle="This session becomes the parent: each step runs as a sub-session under it." onClose={onClose} hook="run-pipeline">
      {pipelines === null && !error && <p className="py-2 text-ui text-muted">Loading pipelines…</p>}
      {pipelines?.length === 0 && <p className="py-2 text-ui text-muted">No pipelines for this project. Add one in Switchboard on your computer, in Settings › Pipelines.</p>}
      <div className="-mx-1 flex flex-col">
        {pipelines?.map((pipeline) => (
          <button key={pipeline.id} type="button" disabled={Boolean(starting)} onClick={() => void run(pipeline)} aria-busy={starting === pipeline.id || undefined} className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left enabled:hover:bg-border/45 enabled:active:bg-selected disabled:opacity-60" data-remote-run-pipeline={pipeline.id}>
            {starting === pipeline.id ? <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-ink" aria-hidden /> : <ListTree className="size-4 shrink-0 text-pipeline" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium">{starting === pipeline.id ? `Starting ${pipeline.name}…` : pipeline.name}</span>
              <span className="block truncate text-meta text-muted">{pipelineMeta(pipeline)}</span>
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-error/10 px-3 py-2 text-ui text-error">
          {error}
        </p>
      )}
    </Sheet>
  );
}
