import { useId, useState } from 'react';
import { Check, ChevronRight, Link2, X } from 'lucide-react';
import type { RunBriefBlock } from '@seshboard/protocol/client';
import { usePipelines } from '../../state/pipelinesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { actionDetail } from './runView.ts';

/** The fold of a block as Claude read it, under a row's What Claude got. */
function Got({ id, text }: { id: string; text: string }) {
  return (
    <pre id={id} className="mt-1.5 max-h-72 overflow-auto rounded-md bg-code p-2.5 font-mono text-meta whitespace-pre-wrap text-text [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}

/**
 * In a step's prompt card (#179), the project actions that ran before Claude started: a check or a cross, the name,
 * its exit code and what its output ends with ("Test exit 0 · 214 passed"), and the output Claude got.
 */
export function ActionResults({ actions }: { actions: ReadonlyArray<{ name: string; exitCode: number | null; tail: string }> }) {
  if (!actions.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1" aria-label="Project actions that ran first" data-step-actions>
      {actions.map((action, i) => (
        <ActionRow key={`${action.name}:${i}`} action={action} />
      ))}
    </ul>
  );
}

function ActionRow({ action }: { action: { name: string; exitCode: number | null; tail: string } }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ok = action.exitCode === 0;
  return (
    <li className="min-w-0" data-step-action={action.name} data-step-action-ok={ok}>
      <div className="flex min-w-0 items-center gap-1.5 text-meta">
        {ok ? <Check size={13} className="shrink-0 text-ok" aria-label="Passed" /> : <X size={13} className="shrink-0 text-error" aria-label={action.exitCode === null ? 'Did not run' : 'Failed'} />}
        <span className="shrink-0 text-ui font-semibold text-text">{action.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{actionDetail(action)}</span>
        {action.tail.trim() && (
          <button type="button" className="flex shrink-0 items-center gap-0.5 text-link hover:underline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-what-claude-got>
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            What Claude got
          </button>
        )}
      </div>
      {open && <Got id={id} text={action.tail} />}
    </li>
  );
}

/**
 * Under a message to a run's parent, the run it linked: "Linked: <pipeline> run", and What Claude got, the run's
 * brief as Claude read it. A click on the name opens the run's parent or run row.
 */
export function LinkedRuns({ runs, divided = true }: { runs: readonly RunBriefBlock[]; divided?: boolean }) {
  if (!runs.length) return null;
  return (
    <ul className={`flex flex-col gap-1 ${divided ? 'mt-2 border-t border-border pt-2' : 'mt-1'}`} aria-label="Linked runs">
      {runs.map((run) => (
        <LinkedRunRow key={run.runId} run={run} />
      ))}
    </ul>
  );
}

function LinkedRunRow({ run }: { run: RunBriefBlock }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const target = usePipelines((s) => {
    const state = s.runs.get(run.runId);
    return state ? (state.run.parentSessionId ?? state.run.id) : null;
  });
  const here = useSessions((s) => s.selectedId);
  return (
    <li className="min-w-0" data-linked-run={run.runId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta">
        <Link2 size={12} className="shrink-0 text-accent-ink" aria-hidden />
        <span className="text-muted">Linked:</span>
        {target && target !== here ? (
          <button type="button" className="min-w-0 truncate text-ui font-semibold text-text hover:underline" onClick={() => useSessions.getState().select(target)}>
            {run.label}
          </button>
        ) : (
          <span className="min-w-0 truncate text-ui font-semibold text-text">{run.label}</span>
        )}
        <span className="text-muted">run</span>
        {!run.stub && (
          <button type="button" className="ml-auto flex shrink-0 items-center gap-0.5 text-link hover:underline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-what-claude-got>
            <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            What Claude got
          </button>
        )}
      </div>
      {open && <Got id={id} text={`run: ${run.runId}\n${run.body}`} />}
    </li>
  );
}
