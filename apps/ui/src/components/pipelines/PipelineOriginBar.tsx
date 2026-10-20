import { Workflow } from 'lucide-react';
import { originLine, originOf, taskTitle } from '../../state/pipelines.ts';
import { useRuns } from '../../state/pipelinesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';

/**
 * Under the header of a session that is a step of a pipeline: "Execute · step 2 of Plan, execute, validate, push",
 * with a link back to the parent (the session the run started from, or the run's own row).
 */
export function PipelineOriginBar({ sessionId }: { sessionId: string | null }) {
  const runs = useRuns();
  const origin = originOf(sessionId, runs);
  const parentTitle = useSessions((s) => {
    if (!origin) return null;
    if (origin.parentId.startsWith('run:')) return null;
    return s.sessions.get(origin.parentId)?.title ?? null;
  });
  if (!origin) return null;
  const line = originLine(origin);
  const parent = parentTitle ?? taskTitle(runs.find((r) => r.run.id === origin.runId)?.run.task ?? '', 50);
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-1.5 border-b border-border px-6 py-1 text-meta text-muted" data-pipeline-origin={origin.runId}>
      <Workflow size={12} className="shrink-0 text-faint" aria-hidden />
      <span>
        <span className="font-semibold text-text">{line.head}</span> · {line.tail}
      </span>
      <span aria-hidden>·</span>
      <button type="button" onClick={() => useSessions.getState().select(origin.parentId)} className="min-w-0 truncate text-link hover:underline" data-pipeline-origin-link>
        {`Back to ${parent || 'the run'}`}
      </button>
    </div>
  );
}
