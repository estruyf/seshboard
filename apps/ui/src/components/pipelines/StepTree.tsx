import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleStop, CircleX, Clock, GitFork, ListTree, LoaderCircle, Play, RotateCcw, SkipForward, Square, TriangleAlert } from 'lucide-react';
import type { PipelineRunState } from '@switchboard/protocol/client';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { continueRun, retryStep, skipStep, stopRun, usePipelines } from '../../state/pipelinesStore.ts';
import { currentIndex, runHeaderLine, stepLabel, stepView, type StepView } from '../../state/pipelines.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { PushCard } from './PushCard.tsx';
import { holdLine, runButtons, stepDetail, stepDuration, stepMeta, stepPills, stepRowName, stopNotice, type StopNotice } from './runView.ts';

/** The time, every 30 seconds while `active`, so a running step's duration moves. */
export function useNow(active: boolean, every = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [active, every]);
  return now;
}

/** A step's state as an icon: done, working, needs you, waiting, failed, skipped or stopped. */
export function StepIcon({ view, size = 16 }: { view: StepView; size?: number }) {
  switch (view) {
    case 'done':
      return <CircleCheck size={size} className="shrink-0 text-ok" aria-hidden />;
    case 'working':
      return <LoaderCircle size={size} className="shrink-0 animate-spin text-accent-ink" aria-hidden />;
    case 'needsYou':
      return <CircleAlert size={size} className="shrink-0 animate-pulse text-warn" aria-hidden />;
    case 'failed':
      return <CircleX size={size} className="shrink-0 text-error" aria-hidden />;
    case 'skipped':
      return <CircleMinus size={size} className="shrink-0 text-faint" aria-hidden />;
    case 'stopped':
      return <CircleStop size={size} className="shrink-0 text-muted" aria-hidden />;
    default:
      return <CircleDashed size={size} className="shrink-0 text-faint" aria-hidden />;
  }
}

/** A run's stop: what happened and what to do, on the step tree and in the step it stopped at. */
export function RunStopNotice({ notice, className = '' }: { notice: StopNotice; className?: string }) {
  return (
    <Notice
      tone={notice.kind === 'paused' ? 'neutral' : notice.kind === 'confirm' ? 'info' : 'caution'}
      icon={notice.kind === 'paused' ? <Clock size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
      className={className}
      data-run-stop={notice.kind}
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-text">{notice.title}</span>
        {notice.advice && <span className="text-meta text-muted">{notice.advice}</span>}
      </span>
    </Notice>
  );
}

/**
 * The parent's step tree (#179): the pipeline, where the run is and how long it has taken, the run's buttons, then each
 * step as a row with its state, model and mode, its pills, what it did, how long it took and Open. The step the run is
 * at has the accent frame. Push's card shows in the tree while the run waits for it.
 */
export function StepTreeCard({ state, className = '' }: { state: PipelineRunState; className?: string }) {
  const { run } = state;
  const active = run.status === 'running' || run.status === 'waiting';
  const now = useNow(active);
  const busy = usePipelines((s) => s.busy.has(run.id));
  const buttons = runButtons(state);
  const notice = stopNotice(state);
  const hold = holdLine(run);
  const current = currentIndex(state);
  const busyProps = { disabled: busy, 'aria-busy': busy || undefined } as const;
  return (
    <section className="@container rounded-xl border border-border bg-card px-4 py-3 @max-[560px]:px-3" aria-label={`${run.pipeline.name} run`} data-pipeline-tree={run.id} data-run-status={run.status}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <ListTree size={15} className="shrink-0 text-pipeline" aria-hidden />
        <h2 className="min-w-0 truncate text-ui font-semibold text-text">{run.pipeline.name}</h2>
        <span className="shrink-0 text-meta text-muted tabular-nums" data-run-progress>
          {run.status === 'done' ? `done · ${runHeaderLine(state, now).split(' · ').at(-1)}` : run.status === 'stopped' ? 'stopped' : runHeaderLine(state, now)}
        </span>
        {run.pr && (
          <Pill tone="link" onClick={() => void window.open(run.pr!.url, '_blank')} data-tooltip="Open on GitHub" data-run-pr>
            #{run.pr.number}
          </Pill>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {busy && <LoaderCircle size={13} className="animate-spin text-accent-ink" aria-label="Working on it" />}
          {buttons.continue && (
            <Button size="sm" variant="primary" icon={<Play size={12} aria-hidden />} onClick={() => void continueRun(run.id)} {...busyProps} data-run-continue>
              Continue
            </Button>
          )}
          {buttons.skip && (
            <Button size="sm" icon={<SkipForward size={12} aria-hidden />} onClick={() => void skipStep(run.id)} {...busyProps} data-run-skip>
              <span className="@max-[560px]:sr-only">Skip this step</span>
            </Button>
          )}
          {buttons.retry && (
            <Button size="sm" icon={<RotateCcw size={12} aria-hidden />} onClick={() => void retryStep(run.id)} {...busyProps} data-run-retry>
              <span className="@max-[560px]:sr-only">Run this step again</span>
            </Button>
          )}
          {buttons.stop && (
            <Button size="sm" variant="danger" icon={<Square size={11} aria-hidden />} onClick={() => void stopRun(run.id)} {...busyProps} data-run-stop-button>
              <span className="@max-[560px]:sr-only">Stop the run</span>
            </Button>
          )}
        </div>
      </div>
      {notice && <RunStopNotice notice={notice} className="mt-2.5" />}
      {hold && (
        <p className="mt-2 flex items-center gap-1.5 text-meta text-muted" role="status" data-run-hold={run.hold}>
          <Clock size={12} aria-hidden />
          {hold}
        </p>
      )}
      <ol role="list" className="mt-2 flex flex-col gap-0.5" aria-label="Steps">
        {run.pipeline.steps.map((step, index) =>
          step.kind === 'push' && run.status === 'waiting' && run.waitingFor === 'push' && run.step === index ? (
            <li key={index} className="py-1" aria-label={stepLabel(state, index)} data-pipeline-step={step.name}>
              <PushCard state={state} />
            </li>
          ) : (
            <StepRow key={index} state={state} index={index} current={index === current} now={now} />
          ),
        )}
      </ol>
    </section>
  );
}

function StepRow({ state, index, current, now }: { state: PipelineRunState; index: number; current: boolean; now: number }) {
  const step = state.run.pipeline.steps[index]!;
  const { view, row } = stepView(state, index);
  const catchUp = useCatchUp((s) => (row?.sessionId ? (s.cards.get(row.sessionId) ?? null) : null));
  const detail = stepDetail(state, index, catchUp);
  const duration = stepDuration(row, now);
  const pills = stepPills(step, row);
  const sessionId = row?.sessionId ?? null;
  return (
    <li
      className={`flex min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-1.5 ${current ? 'border-accent-ink/60 bg-accent/10' : 'border-transparent'}`}
      aria-label={stepLabel(state, index)}
      aria-current={current ? 'step' : undefined}
      data-pipeline-step={step.name}
      data-step-view={view}
    >
      <span className="flex h-5 items-center">
        <StepIcon view={view} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-ui font-semibold text-text">{stepRowName(step, row)}</span>
          <span className="min-w-0 truncate text-meta text-muted">{stepMeta(step)}</span>
          {pills.map((pill) =>
            pill.kind === 'round' ? (
              <Pill key={pill.kind} tone="accent">
                {pill.text}
              </Pill>
            ) : (
              <span key={pill.kind} className="inline-flex items-center gap-1 rounded-full bg-pipeline/15 px-1.5 text-meta font-medium text-pipeline">
                {pill.kind === 'fork' && <GitFork size={10} aria-hidden />}
                {pill.text}
              </span>
            ),
          )}
        </div>
        {detail && <p className={`mt-0.5 text-meta [overflow-wrap:anywhere] ${view === 'failed' ? 'text-error' : view === 'needsYou' ? 'text-warn' : 'text-muted'}`}>{detail}</p>}
      </div>
      <span className="flex h-5 shrink-0 items-center gap-2">
        {duration && <span className="text-meta text-muted tabular-nums">{duration}</span>}
        {sessionId && (
          <button type="button" className="text-ui text-link hover:underline" onClick={() => useSessions.getState().select(sessionId)} aria-label={`Open ${stepRowName(step, row)}`} data-step-open={sessionId}>
            Open
          </button>
        )}
      </span>
    </li>
  );
}
