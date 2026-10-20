import { useEffect, useState } from 'react';
import { GitBranch, GitPullRequest, LoaderCircle, Play, SkipForward, Square, ShieldCheck, RotateCcw } from 'lucide-react';
import type { PipelineRun, PipelineRunState, PipelinePushDraft } from '@switchboard/protocol/client';
import { MODE_LABEL } from '../../lib/modes.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { catchUpLine, heldLine, pushBusyLabel, pushLabel, runActions, STEP_STATE_LABEL, STEP_TONE, stepViews, modelName, shownRun, type StepView } from '../../state/pipelines.ts';
import { continueRun, isBusy, pushDraft, pushRun, retryStep, skipStep, stopRun, trustRun, usePipelines, useRuns } from '../../state/pipelinesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

const FIELD = 'rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

/**
 * A parent's pipeline run above its conversation (where a trigger's origin bar sits): the step tree with each step's
 * model, state, one line of what it did and its round, the buttons that apply (Continue, Run this step again, Skip this
 * step, Stop the run), and the Push card or the trust card when the run waits for those. It scrolls inside a fixed
 * height, so it never pushes the message box off screen, and folds to its header.
 */
export function PipelineRunPanel({ parentId }: { parentId: string | null }) {
  const runs = useRuns();
  const state = parentId ? shownRun(parentId, runs) : null;
  if (!state) return null;
  return <RunPanel key={state.run.id} state={state} />;
}

function RunPanel({ state }: { state: PipelineRunState }) {
  const { run, steps } = state;
  const [open, setOpen] = useState(run.state !== 'done' && run.state !== 'stopped');
  const views = stepViews(run, steps);
  const actions = runActions(run);
  const held = heldLine(run);
  const busy = usePipelines((s) => s.busy);
  const needsYou = run.state === 'needs-you';
  const total = run.pipeline.steps.length;
  const at = views.find((v) => v.current);
  const summary = run.state === 'done' ? 'Done' : run.state === 'stopped' ? 'Stopped' : at ? `${at.name} · ${Math.min(at.index + 1, total)} of ${total}` : '';
  const stepName = run.pipeline.steps[Math.min(run.stepIndex, total - 1)]?.name ?? '';

  const act = (what: string, label: string, busyLabel: string, run_: () => Promise<boolean>, icon: React.ReactNode, primary = false) => {
    const working = isBusy(busy, run.id, what);
    return (
      <Button
        variant={primary ? 'primary' : 'secondary'}
        icon={working ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : icon}
        aria-busy={working || undefined}
        onClick={() => !working && void run_()}
        data-pipeline-action={what}
      >
        {working ? busyLabel : label}
      </Button>
    );
  };

  return (
    <section
      aria-label={`Pipeline: ${run.pipeline.name}`}
      className={`shrink-0 border-b border-border px-6 py-2 @max-[860px]:px-4`}
      data-pipeline-panel={run.id}
      data-pipeline-state={run.state}
    >
      <div className={`rounded-xl border bg-card ${needsYou ? 'border-warn/60' : 'border-border'}`}>
        <div className="flex min-h-9 items-center gap-2 px-3">
          <SectionHeader
            as="h2"
            className="min-w-0 flex-1"
            toggle={{ expanded: open, onToggle: () => setOpen((o) => !o), leading: true, tooltip: open ? 'Fold the steps' : 'Show the steps', data: { 'data-pipeline-panel-toggle': true } }}
          >
            {run.pipeline.name}
          </SectionHeader>
          <span className={`min-w-0 truncate text-meta ${needsYou ? 'font-medium text-warn' : run.state === 'running' ? 'text-accent-ink' : 'text-muted'}`} data-pipeline-progress>
            {summary}
          </span>
        </div>
        {open && (
          <div className="grid max-h-[38vh] gap-2 overflow-y-auto px-3 pb-3">
            <ol className="grid gap-px" aria-label="Steps">
              {views.map((view) => (
                <StepRow key={view.index} view={view} />
              ))}
            </ol>
            {held && (
              <p className={`text-ui ${needsYou ? 'text-warn' : 'text-muted'}`} data-pipeline-held={run.heldBy ?? undefined}>
                {held.label}
                {held.note && <span className="text-muted">{`. ${held.note}`}</span>}
              </p>
            )}
            {run.heldBy === 'trust' && needsYou && <TrustCard run={run} />}
            {run.heldBy === 'push' && needsYou && <PushCard run={run} />}
            {(actions.continue || actions.retry || actions.skip || actions.stop) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {actions.continue && act('continue the run', run.heldBy === 'confirm' ? `Start ${stepName}` : 'Continue', 'Continuing…', () => continueRun(run.id), <Play size={13} aria-hidden />, actions.primary === 'continue')}
                {actions.retry && act('run the step again', 'Run this step again', 'Starting…', () => retryStep(run.id), <RotateCcw size={13} aria-hidden />, actions.primary === 'retry')}
                {actions.skip && act('skip the step', 'Skip this step', 'Skipping…', () => skipStep(run.id), <SkipForward size={13} aria-hidden />)}
                {actions.stop && act('stop the run', 'Stop the run', 'Stopping…', () => stopRun(run.id), <Square size={12} aria-hidden />)}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** One step of the tree: its state, name, model and round, a line of what it did, and a click that opens its session. */
function StepRow({ view }: { view: StepView }) {
  const card = useCatchUp((s) => (view.sessionId ? s.cards.get(view.sessionId) : undefined));
  const tone = STEP_TONE[view.state];
  const line = view.note ?? catchUpLine(card);
  const open = (id: string) => useSessions.getState().select(id);
  const body = (
    <>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone.dot} ${view.state === 'running' ? 'animate-pulse' : ''}`} aria-hidden />
      <span className="grid min-w-0 flex-1 gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-ui font-medium text-text">{view.name}</span>
          {view.model && <span className="shrink-0 text-meta text-faint">{view.model}</span>}
          {view.kind === 'push' && <GitPullRequest size={11} className="shrink-0 text-faint" aria-hidden />}
          {view.round > 1 && <Pill tone="muted">{`Round ${view.round}`}</Pill>}
          {view.verdict && <Pill tone={view.verdict === 'pass' ? 'ok' : 'caution'}>{view.verdict === 'pass' ? 'Pass' : 'Changes needed'}</Pill>}
          <span className={`ml-auto shrink-0 text-meta ${tone.text}`}>{STEP_STATE_LABEL[view.state]}</span>
        </span>
        {(line || view.forks) && (
          <span className="truncate text-meta text-muted">
            {view.forks && !line ? `Forks ${view.forks}` : line}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li data-pipeline-step={view.index} data-step-state={view.state} data-step-current={view.current || undefined} aria-current={view.current ? 'step' : undefined}>
      {view.sessionId ? (
        <button
          type="button"
          onClick={() => open(view.sessionId!)}
          data-tooltip="Open this step’s session"
          className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-border/45"
          data-pipeline-step-open={view.sessionId}
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-start gap-2.5 px-1.5 py-1">{body}</div>
      )}
      {view.earlier.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-1 pl-6 text-meta text-muted">
          {view.earlier.map((e) => (
            <button key={e.sessionId} type="button" onClick={() => open(e.sessionId)} className="rounded px-1 hover:bg-border/45 hover:text-text" data-pipeline-round={e.round}>
              {`Round ${e.round}`}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The first run of a shared pipeline, or after its file changed: every step with its prompt, model, mode and the
 * commands of the actions it runs first, so you read what a teammate's pipeline will do before it does it.
 */
function TrustCard({ run }: { run: PipelineRun }) {
  const busy = usePipelines((s) => s.busy);
  const { actions } = useProjectActionList(run.root);
  const working = isBusy(busy, run.id, 'start the run');
  const commandOf = (name: string) => actions.find((a) => a.id === name || a.name === name)?.command ?? null;
  return (
    <div className="grid gap-2 rounded-lg border border-edge bg-bg p-3" data-pipeline-trust={run.id}>
      <p className="flex items-center gap-1.5 text-ui font-semibold text-text">
        <ShieldCheck size={14} className="text-link" aria-hidden />
        Check this pipeline before it runs
      </p>
      <p className="text-ui text-muted">It comes from the project’s .switchboard.json. These are its steps. Start runs them as written.</p>
      <ol className="grid gap-2">
        {run.pipeline.steps.map((step, i) => (
          <li key={i} className="grid gap-1 rounded-md border border-edge p-2" data-trust-step={i}>
            <p className="flex flex-wrap items-center gap-x-2 text-ui font-medium text-text">
              {step.name}
              {step.kind === 'claude' ? (
                <span className="text-meta font-normal text-muted">{`${modelName(step.model)} · ${MODE_LABEL[step.permissionMode ?? 'default']}${step.readOnly ? ' · reads only' : ''}`}</span>
              ) : (
                <span className="text-meta font-normal text-muted">{step.pullRequest ? 'Commits, pushes and opens a pull request' : step.commit ? 'Commits and pushes' : 'Pushes'}</span>
              )}
            </p>
            {step.kind === 'claude' && (
              <>
                <pre className="max-h-32 overflow-auto rounded bg-code px-2 py-1 font-mono text-meta whitespace-pre-wrap text-text">{step.prompt}</pre>
                {step.actionsFirst?.map((name) => (
                  <p key={name} className="text-meta text-muted">
                    Runs the action <span className="font-medium text-text">{name}</span> first
                    {commandOf(name) ? (
                      <>
                        {': '}
                        <code className="font-mono text-text">{commandOf(name)}</code>
                      </>
                    ) : (
                      '. This project has no action with that name.'
                    )}
                  </p>
                ))}
              </>
            )}
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="primary"
          size="lg"
          icon={working ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
          aria-busy={working || undefined}
          onClick={() => !working && void trustRun(run.id)}
          data-pipeline-trust-start
        >
          {working ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The run waits at its Push step: the commit message, the pull request's title and body (all editable), and one button
 * that commits, pushes and opens the pull request. The button shows where it is (Committing…, Pushing…, Opening pull
 * request…); a failure leaves the card as it was, with the reason.
 */
function PushCard({ run }: { run: PipelineRun }) {
  const [draft, setDraft] = useState<PipelinePushDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commit, setCommit] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const progress = usePipelines((s) => s.push.get(run.id) ?? null);
  const step = run.pipeline.steps[run.stepIndex];
  const pushStep = step?.kind === 'push' ? step : undefined;

  useEffect(() => {
    let current = true;
    setDraft(null);
    setError(null);
    void pushDraft(run.id).then(
      (d) => {
        if (!current) return;
        setDraft(d);
        setCommit(d.commitMessage ?? '');
        setTitle(d.prTitle ?? '');
        setBody(d.prBody ?? '');
      },
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [run.id, run.stepIndex]);

  const going = progress !== null && (progress.step === 'commit' || progress.step === 'push' || progress.step === 'create');
  const finished = progress?.step === 'done';
  const failed = progress?.step === 'failed' ? progress.error : null;
  const label = pushLabel(pushStep);
  return (
    <div className="grid gap-2 rounded-lg border border-edge bg-bg p-3" data-pipeline-push={run.id}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui font-semibold text-text">
        <GitBranch size={14} className="text-muted" aria-hidden />
        Ready to push
        {draft?.branch && <span className="font-mono text-meta font-normal text-muted">{draft.branch}</span>}
        {draft && draft.uncommitted > 0 && <span className="text-meta font-normal text-muted">{`${draft.uncommitted} ${draft.uncommitted === 1 ? 'file' : 'files'} to commit`}</span>}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!draft && !error && (
        <p className="flex items-center gap-1.5 text-ui text-muted" role="status">
          <LoaderCircle size={13} className="animate-spin" aria-hidden />
          Writing message…
        </p>
      )}
      {draft?.refused && <Notice tone="warn">{draft.refused}</Notice>}
      {draft && draft.commitMessage !== null && (
        <label className="grid gap-1 text-meta text-muted">
          Commit message
          <textarea value={commit} onChange={(e) => setCommit(e.target.value)} rows={3} spellCheck className={`${FIELD} py-1.5 text-text`} data-push-commit />
        </label>
      )}
      {draft && draft.prTitle !== null && (
        <>
          <label className="grid gap-1 text-meta text-muted">
            {draft.base ? `Pull request title, into ${draft.base}` : 'Pull request title'}
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`h-8 ${FIELD}`} data-push-title />
          </label>
          <label className="grid gap-1 text-meta text-muted">
            Pull request description
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} spellCheck className={`${FIELD} py-1.5 text-text`} data-push-body />
          </label>
        </>
      )}
      {failed && <Notice tone="error">{failed}</Notice>}
      {finished && (
        <Notice tone="success" data-push-done>
          {progress.pr ? (
            <>
              Pull request #{progress.pr.number} opened.{' '}
              <a href={progress.pr.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Open it
              </a>
            </>
          ) : progress.compareUrl ? (
            <>
              Pushed.{' '}
              <a href={progress.compareUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Compare the branch
              </a>
            </>
          ) : (
            'Pushed.'
          )}
        </Notice>
      )}
      <div>
        <Button
          variant="primary"
          size="lg"
          icon={going ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <GitPullRequest size={14} aria-hidden />}
          aria-busy={going || undefined}
          disabled={!draft || going || finished || !!draft.refused || (draft.prTitle !== null && !title.trim())}
          onClick={() => void pushRun(run.id, { commitMessage: draft?.commitMessage !== null ? commit : null, prTitle: draft?.prTitle !== null ? title : null, prBody: draft?.prTitle !== null ? body : null })}
          data-pipeline-push-button
        >
          {going ? (pushBusyLabel(progress.step) ?? 'Pushing…') : label}
        </Button>
      </div>
    </div>
  );
}
