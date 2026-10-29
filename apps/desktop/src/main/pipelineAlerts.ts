import type { PipelineNotice, PipelineRunState } from '@seshboard/protocol/client';
import type { AttentionEvent } from './attention.ts';

/**
 * What pipelines (#179) tell you, as notifications: a run that waits for you without a session asking (before a step
 * with Wait for me, or Push), one that stopped (no verdict, still changes needed after its rounds), and one that is
 * done, with its pull request. A click opens the step's sub-session, the parent, or the run row.
 */
export function pipelineAlerts(notice: PipelineNotice): AttentionEvent[] {
  const sessionId = notice.sessionId ?? notice.runId;
  switch (notice.kind) {
    case 'needsYou':
      return [{ kind: 'needs-you', sessionId, title: notice.title, body: notice.body }];
    case 'stopped':
      return [{ kind: 'pipeline-stopped', sessionId, title: `${notice.title}: the run stopped`, body: notice.body }];
    case 'done':
      return [{ kind: 'pipeline-done', sessionId, title: notice.title, body: notice.body }];
  }
}

/**
 * The sub-sessions of runs that go on: a turn that ends there is the run's news, not yours, so it gives no Finished
 * notification (the run says when it needs you, stops or is done).
 */
export function stepSessions(runs: Iterable<PipelineRunState>): Set<string> {
  const out = new Set<string>();
  for (const { run, steps } of runs) {
    if (run.status === 'done' || run.status === 'stopped') continue;
    for (const step of steps) if (step.sessionId) out.add(step.sessionId);
  }
  return out;
}
