import { ListTree, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentIndex, runButtons, runHeaderLine, STEP_VIEW_WORD, stepView, stopNotice, waitsForPush, type Computer, type Contract, type PushPreview, type RemoteRunState, type RpcClient } from '@seshboard/protocol/client';
import { modKey } from '../../lib/shortcuts.ts';
import { useComputers } from '../../state/computersStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { callComputer } from './callComputer.ts';

const VIEW_TONE = { done: 'text-ok', working: 'text-accent-ink', needsYou: 'text-warn', waiting: 'text-muted', failed: 'text-error', skipped: 'text-faint', stopped: 'text-error' } as const;

type RunAction = 'continue' | 'anotherRound' | 'retryStep' | 'skipStep' | 'stop';
const METHOD = { continue: 'runs.continue', anotherRound: 'runs.anotherRound', retryStep: 'runs.retryStep', skipStep: 'runs.skipStep', stop: 'runs.stop' } as const;
const DOING: Record<RunAction, string> = { continue: 'Continuing…', anotherRound: 'Sending back…', retryStep: 'Starting again…', skipStep: 'Skipping…', stop: 'Stopping…' };

/**
 * A pipeline run on another computer, above the message box of the session it started from or of one of its steps
 * (`runOfParent`, `runOfStep`): its steps with where each is (a step's sub-session opens here), why it stopped, and
 * the buttons the run offers now (`runButtons`): Continue, Another round, Run this step again, Skip and Stop, and Push
 * with its commit message when it waits there. Everything runs on that computer.
 */
export function RemoteRunCard({ client, computer, state, now }: { client: RpcClient<Contract>; computer: Computer; state: RemoteRunState; now: number }) {
  const { run } = state;
  const connected = computer.state === 'connected';
  const [busy, setBusy] = useState<RunAction | null>(null);
  const [pushing, setPushing] = useState(false);
  const buttons = runButtons(state);
  const notice = stopNotice(state);
  const at = currentIndex(state);

  const act = async (action: RunAction) => {
    if (busy || !connected) return;
    setBusy(action);
    try {
      await callComputer(client, computer.id, METHOD[action], { runId: run.id });
    } catch (e) {
      toast((e as Error).message, { body: `On ${computer.name}.` });
    } finally {
      setBusy(null);
    }
  };
  const open = (sessionId: string) => useComputers.getState().openSession({ computerId: computer.id, sessionId });

  return (
    <section aria-label={`Pipeline run ${run.title}`} className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5" data-remote-run={run.id} data-remote-run-status={run.status}>
      <div className="flex min-w-0 items-center gap-2 text-ui">
        <ListTree size={13} aria-hidden className="shrink-0 text-pipeline" />
        <span className="min-w-0 truncate font-semibold">{run.pipeline.name}</span>
        <span className="min-w-0 truncate text-meta text-muted">{runHeaderLine(state, now)}</span>
      </div>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-meta" aria-label="Steps">
        {run.pipeline.steps.map((step, index) => {
          const { view, row } = stepView(state, index);
          const label = (
            <>
              <span className={index === at ? 'font-semibold text-text' : 'text-text/85'}>{step.name}</span>
              <span className={VIEW_TONE[view]}>{STEP_VIEW_WORD[view]}</span>
            </>
          );
          return (
            <li key={index} className="flex items-center gap-1.5" data-remote-run-step={view}>
              {index > 0 && (
                <span aria-hidden className="text-faint">
                  ›
                </span>
              )}
              {row?.sessionId ? (
                <button type="button" onClick={() => open(row.sessionId!)} className="flex items-center gap-1 rounded px-1 hover:bg-border/45" data-tooltip={`Open ${step.name}`}>
                  {label}
                </button>
              ) : (
                <span className="flex items-center gap-1 px-1">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
      {notice && (
        <p className={`text-ui ${notice.kind === 'stop' ? 'text-error' : 'text-muted'}`} data-remote-run-notice>
          {notice.title}
          {notice.advice && <span className="text-muted"> · {notice.advice}</span>}
        </p>
      )}
      {(buttons.continue || buttons.anotherRound || buttons.retry || buttons.skip || buttons.stop || waitsForPush(state)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {waitsForPush(state) && (
            <Button variant="primary" size="sm" icon={<Upload size={13} aria-hidden />} disabled={!connected} onClick={() => setPushing(true)} data-remote-run-push>
              Push…
            </Button>
          )}
          {buttons.continue && <RunButton action="continue" label="Continue" primary busy={busy} disabled={!connected} onClick={act} />}
          {buttons.anotherRound && <RunButton action="anotherRound" label="Another round" busy={busy} disabled={!connected} onClick={act} />}
          {buttons.retry && <RunButton action="retryStep" label="Run this step again" busy={busy} disabled={!connected} onClick={act} />}
          {buttons.skip && <RunButton action="skipStep" label="Skip" busy={busy} disabled={!connected} onClick={act} />}
          {buttons.stop && <RunButton action="stop" label="Stop the run" danger busy={busy} disabled={!connected} onClick={act} />}
        </div>
      )}
      {pushing && <PushDialog client={client} computer={computer} runId={run.id} onClose={() => setPushing(false)} />}
    </section>
  );
}

function RunButton({ action, label, primary = false, danger = false, busy, disabled, onClick }: { action: RunAction; label: string; primary?: boolean; danger?: boolean; busy: RunAction | null; disabled: boolean; onClick(action: RunAction): void }) {
  return (
    <Button variant={primary ? 'primary' : danger ? 'danger' : 'secondary'} size="sm" disabled={disabled || busy !== null} aria-busy={busy === action || undefined} onClick={() => onClick(action)} data-remote-run-action={action}>
      {busy === action ? DOING[action] : label}
    </Button>
  );
}

/** Push on that computer: the commit message it wrote from the diff (which you can change), what goes where, then Push. */
function PushDialog({ client, computer, runId, onClose }: { client: RpcClient<Contract>; computer: Computer; runId: string; onClose(): void }) {
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void callComputer(client, computer.id, 'runs.pushPreview', { runId, fresh: false }).then(
      ({ preview: p }) => {
        if (!live) return;
        setPreview(p);
        setMessage(p.message);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [client, computer.id, runId]);
  const push = async () => {
    if (busy || !message.trim() || preview?.problem) return;
    setBusy(true);
    setError(null);
    try {
      await callComputer(client, computer.id, 'runs.continue', { runId, message: message.trim() });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      width="sm"
      title="Push"
      subtitle={preview ? [`${preview.files} ${preview.files === 1 ? 'file' : 'files'}`, preview.branch && preview.base ? `${preview.branch} → ${preview.base}` : preview.branch, `on ${computer.name}`].filter(Boolean).join(' · ') : 'Writing the commit message…'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="⌘↵" disabled={!preview || !!preview.problem || !message.trim() || busy} aria-busy={busy || undefined} onClick={() => void push()} data-remote-push-confirm>
            {busy ? 'Pushing…' : 'Push'}
          </Button>
        </>
      }
      data-remote-push-dialog
    >
      <div className="grid gap-2">
        {preview?.problem && <p className="text-ui text-error">{preview.problem}</p>}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && modKey(event)) {
              event.preventDefault();
              void push();
            }
          }}
          rows={5}
          disabled={!preview || busy}
          aria-label="Commit message"
          className="w-full resize-y rounded-lg border border-edge bg-card px-2.5 py-1.5 font-mono text-ui text-text outline-none focus:border-link disabled:opacity-60"
        />
        {error && (
          <p role="alert" className="text-ui text-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
