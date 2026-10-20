import { useState, type KeyboardEvent } from 'react';
import { ArrowUp, LoaderCircle, Workflow } from 'lucide-react';
import { runIsOpen, shownRun } from '../../state/pipelines.ts';
import { useRuns, writeToRun } from '../../state/pipelinesStore.ts';
import { Button } from '../ui/Button.tsx';
import { PaneClose } from '../split/PaneClose.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { paneHandle, paneHeader, type PaneProps } from '../computers/ComputerView.tsx';
import { PipelineRunPanel } from './PipelineRunPanel.tsx';

/**
 * A run started from New session has no session of its own yet: this is its view. The task it was started with, the
 * run's steps (the same panel a parent shows), and a message box. Writing starts a normal session in the run's folder
 * with a brief of the run before your text; that session becomes the run's parent and opens here in its place.
 */
export function RunRowView({ runId, pane }: { runId: string; pane: PaneProps }) {
  const rowId = `run:${runId}`;
  const runs = useRuns();
  const state = shownRun(rowId, runs);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const handle = paneHandle(pane);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const id = await writeToRun(runId, message);
    // The new session opens in this pane's place; a failure keeps what was typed.
    if (id === null) setSending(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-run-view={runId}>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6 @max-[860px]:gap-2 @max-[860px]:px-4" {...paneHeader(pane)}>
        {pane.leading && <SidebarToggle />}
        <Workflow size={16} aria-hidden className="shrink-0 text-muted" />
        <div className={`min-w-0 flex-1 ${handle.className}`} data-pane-handle={handle['data-pane-handle']}>
          <h1 className="truncate text-title font-semibold">{state ? state.run.pipeline.name : 'Pipeline run'}</h1>
          <p className="truncate text-meta text-muted">{state ? (state.run.state === 'done' ? 'Done' : state.run.state === 'stopped' ? 'Stopped' : 'Running in the background') : ''}</p>
        </div>
        <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip="Close and go Home (the run keeps going)" />
      </header>
      {!state ? (
        <p className="p-6 text-ui text-muted">This run is no longer listed.</p>
      ) : (
        <>
          <PipelineRunPanel parentId={rowId} />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 @max-[860px]:px-4">
            <div className="mx-auto grid max-w-3xl gap-3">
              <div className="rounded-xl border border-border bg-card px-4 py-3" data-run-task>
                <p className="mb-1 text-meta font-semibold tracking-wider text-faint uppercase">Task</p>
                <p className="text-body whitespace-pre-wrap break-words text-text">{state.run.task}</p>
              </div>
              <p className="text-ui text-muted">
                {runIsOpen(state.run)
                  ? 'The steps run on their own. Write here to talk about the work: a session starts in the run’s folder and knows how the run went.'
                  : 'The run is over. Write here to carry on in the run’s folder with a session that knows how it went.'}
              </p>
            </div>
          </div>
          <div className="shrink-0 px-6 pb-4 @max-[860px]:px-4">
            <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-2" data-run-message-box>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={3}
                spellCheck
                placeholder="Message about this run"
                aria-label="Message about this run"
                className="w-full resize-none bg-transparent px-2 py-1.5 text-body leading-6 text-text outline-none placeholder:text-muted"
                data-run-message
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="lg"
                  icon={sending ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <ArrowUp size={14} aria-hidden />}
                  aria-busy={sending || undefined}
                  disabled={!text.trim() || sending}
                  onClick={() => void send()}
                  data-run-send
                >
                  {sending ? 'Starting…' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
