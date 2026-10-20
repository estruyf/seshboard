import { useId, useState } from 'react';
import { LoaderCircle, Workflow } from 'lucide-react';
import { pipelineBlanks, type Pipeline } from '@switchboard/protocol/client';
import { missingBlanks, pipelineSummary, scopeLabel } from '../../state/pipelines.ts';
import { closeRunPipeline, startRun, usePipelineList, usePipelines, type RunRequest } from '../../state/pipelinesStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';

const FIELD = 'rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

/** Mounted once in the app: opens when something asks to run a pipeline (a menu, the palette, New session). */
export function RunPipelineHost() {
  const request = usePipelines((s) => s.runRequest);
  if (!request) return null;
  return <RunPipelineDialog key={`${request.root}:${request.pipeline?.id ?? 'pick'}`} request={request} />;
}

/**
 * Run pipeline: pick one of the project's pipelines (skipped when one is chosen already), say what the run is for, and
 * fill the blanks its prompts ask for. Start begins the run and says it is starting; a failure stays in the dialog.
 */
function RunPipelineDialog({ request }: { request: RunRequest }) {
  const list = usePipelineList(request.root);
  const [picked, setPicked] = useState<Pipeline | null>(request.pipeline);
  const [task, setTask] = useState(request.task);
  const [values, setValues] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [tried, setTried] = useState(false);
  const taskId = useId();
  const blanks = picked ? pipelineBlanks(picked) : [];
  const missing = picked ? missingBlanks(picked, values) : [];
  const ready = picked !== null && task.trim() !== '' && missing.length === 0;

  const start = async () => {
    setTried(true);
    if (!picked || !ready || starting) return;
    setStarting(true);
    const ok = await startRun({ pipeline: picked, parentSessionId: request.parentSessionId, cwd: request.cwd, task: task.trim(), blanks: values });
    if (ok) {
      request.onStarted?.();
      closeRunPipeline();
    } else setStarting(false);
  };

  return (
    <Dialog
      title="Run pipeline"
      subtitle={picked ? picked.name : 'Pick a pipeline'}
      icon={<Workflow size={16} aria-hidden />}
      width="md"
      onClose={closeRunPipeline}
      onSubmit={picked ? () => void start() : undefined}
      data-run-pipeline-dialog
      footer={
        <>
          <Button onClick={closeRunPipeline}>Cancel</Button>
          {picked && (
            <Button
              variant="primary"
              icon={starting ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : undefined}
              aria-busy={starting || undefined}
              disabled={starting}
              kbd="cmd+enter"
              onClick={() => void start()}
              data-run-pipeline-start
            >
              {starting ? 'Starting…' : 'Start'}
            </Button>
          )}
        </>
      }
    >
      {!picked ? (
        <div className="grid gap-1" role="listbox" aria-label="Pipelines">
          {!list && <p className="text-ui text-muted">Loading…</p>}
          {list?.pipelines.map((pipeline) => (
            <button
              key={`${pipeline.scope.kind}:${pipeline.id}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                if (request.onChoose) {
                  request.onChoose(pipeline);
                  closeRunPipeline();
                } else setPicked(pipeline);
              }}
              className="grid gap-0.5 rounded-lg border border-edge px-3 py-2 text-left hover:bg-border/45"
              data-pipeline-choice={pipeline.id}
            >
              <span className="flex items-center gap-2 text-ui font-medium text-text">
                {pipeline.name}
                <span className="text-meta font-normal text-faint">{scopeLabel(pipeline.scope)}</span>
              </span>
              <span className="text-meta text-muted">{pipeline.steps.map((s) => s.name).join(' → ')}</span>
            </button>
          ))}
          {list?.errors.map((error) => (
            <Notice key={error} tone="caution">
              {error}
            </Notice>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-ui text-muted">
            {pipelineSummary(picked)}. {picked.steps.map((s) => s.name).join(' → ')}.
          </p>
          {picked.scope.kind === 'shared' && <Notice tone="info">This pipeline comes from the project’s .switchboard.json. You check its steps before the first run.</Notice>}
          <div className="grid gap-1">
            <label htmlFor={taskId} className="text-ui text-muted">
              Task
            </label>
            <textarea
              id={taskId}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              autoFocus
              spellCheck
              aria-invalid={tried && !task.trim() ? true : undefined}
              className={`${FIELD} resize-y py-1.5 leading-5 ${tried && !task.trim() ? 'border-error' : ''}`}
              data-run-pipeline-task
            />
            <p className="text-meta text-faint">What the steps work on. The first step gets it as written.</p>
          </div>
          {blanks.map((blank) => (
            <div key={blank.name} className="grid gap-1">
              <label className="text-ui text-muted" htmlFor={`${taskId}-${blank.name}`}>
                {blank.name}
                {blank.optional ? ' (optional)' : ''}
              </label>
              {blank.options.length > 0 ? (
                <Select
                  value={values[blank.name] ?? ''}
                  options={blank.options.map((o) => ({ value: o, label: o }))}
                  onChange={(value) => setValues((v) => ({ ...v, [blank.name]: value }))}
                  label={blank.name}
                  placeholder="Pick one"
                  className="h-8 w-56"
                />
              ) : (
                <input
                  id={`${taskId}-${blank.name}`}
                  value={values[blank.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [blank.name]: e.target.value }))}
                  className={`h-8 ${FIELD} ${tried && missing.includes(blank.name) ? 'border-error' : ''}`}
                  data-run-pipeline-blank={blank.name}
                />
              )}
            </div>
          ))}
          {!request.pipeline && (
            <div>
              <Button variant="quiet" onClick={() => setPicked(null)}>
                Pick another pipeline
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
