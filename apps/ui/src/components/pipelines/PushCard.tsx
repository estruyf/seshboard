import { useEffect, useId, useState } from 'react';
import { GitPullRequestArrow, LoaderCircle, RefreshCw } from 'lucide-react';
import type { PipelineRunState, PushPreview } from '@seshboard/protocol/client';
import { continueRun, loadPushPreview, stopRun, usePipelines } from '../../state/pipelinesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { pushLine } from './runView.ts';

/**
 * Push, while the run waits for it (#179): the commit message Haiku wrote from the diff, what it commits and where it
 * goes, and Commit, push and open PR. Edit message makes the message editable first; Stop here ends the run.
 */
export function PushCard({ state }: { state: PipelineRunState }) {
  const { run } = state;
  const step = run.pipeline.steps[run.step];
  const kept = usePipelines((s) => s.previews.get(run.id) ?? null);
  const busy = usePipelines((s) => s.busy.has(run.id));
  const [preview, setPreview] = useState<PushPreview | null>(kept);
  const [loading, setLoading] = useState(kept === null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(kept?.message ?? '');
  const [pushing, setPushing] = useState(false);
  const messageId = useId();

  const load = (fresh: boolean) => {
    setLoading(true);
    setError(null);
    loadPushPreview(run.id, fresh)
      .then((p) => {
        setPreview(p);
        setMessage(p.message);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (kept) return;
    load(false);
    // Once per run: the store keeps the message after that.
  }, [run.id]);

  const push = async () => {
    setPushing(true);
    try {
      await continueRun(run.id, message.trim() || null);
    } finally {
      setPushing(false);
    }
  };
  const blocked = loading || busy || !!preview?.problem || !message.trim();
  return (
    <div className="rounded-xl border border-accent-ink/60 bg-accent/5 px-3.5 py-3" data-push-card={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <GitPullRequestArrow size={14} className="shrink-0 text-text" aria-hidden />
        <span className="text-ui font-semibold text-text">{step?.name ?? 'Push'}</span>
        <Pill tone="accent">waits for you</Pill>
        {step?.kind === 'push' && step.draft && <span className="text-meta text-muted">opens a draft</span>}
      </div>
      {loading ? (
        <p className="mt-2 flex items-center gap-1.5 text-ui text-muted" role="status" data-push-loading>
          <LoaderCircle size={13} className="animate-spin text-accent-ink" aria-hidden />
          Writing the message…
        </p>
      ) : error ? (
        <Notice
          tone="error"
          className="mt-2"
          actions={
            <Button size="sm" variant="quiet" icon={<RefreshCw size={12} aria-hidden />} onClick={() => load(true)}>
              Try again
            </Button>
          }
        >
          Couldn’t write the message: {error}
        </Notice>
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
                onChange={(e) => setMessage(e.target.value)}
                rows={Math.min(8, Math.max(2, message.split('\n').length))}
                className="mt-2 w-full resize-y rounded-md border border-edge bg-code px-2.5 py-1.5 font-mono text-ui text-text outline-none focus:border-accent-ink"
                autoFocus
                data-push-message-input
              />
            </>
          ) : (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-code px-2.5 py-1.5 font-mono text-ui whitespace-pre-wrap text-text [overflow-wrap:anywhere]" data-push-message>
              {message || 'No message'}
            </pre>
          )}
          {preview && (
            <p className="mt-1.5 truncate text-meta text-muted" data-push-files>
              {pushLine(preview)} · message by Haiku from the diff
            </p>
          )}
          {preview?.problem && (
            <Notice tone="caution" className="mt-2" data-push-problem>
              {preview.problem}
            </Notice>
          )}
        </>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button
          size="lg"
          variant="primary"
          icon={pushing ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : undefined}
          disabled={blocked || pushing}
          aria-busy={pushing || undefined}
          onClick={() => void push()}
          data-push-confirm
        >
          {pushing ? 'Pushing…' : 'Commit, push and open PR'}
        </Button>
        {!editing && (
          <Button size="lg" disabled={loading || !!error} onClick={() => setEditing(true)} data-push-edit>
            Edit message
          </Button>
        )}
        <Button size="lg" disabled={busy || pushing} onClick={() => void stopRun(run.id)} data-push-stop>
          Stop here
        </Button>
      </div>
    </div>
  );
}
