import { Fragment, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, CircleAlert, CircleCheck, CircleMinus, CircleX, Eye, ListTree, Repeat } from 'lucide-react';
import type { PipelineRunState } from '@switchboard/protocol/client';
import { anotherRound, usePipelines, useRunOfParent, useRunOfStep } from '../../state/pipelinesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { markdownComponents } from '../transcript/Markdown.tsx';
import { RunStopNotice, StepTreeCard } from './StepTree.tsx';
import { PARENT_PLACEHOLDER, parentRows, READ_ONLY_LINE, replyToStepPlaceholder, roundDivider, stopNotice, verdictView, waitsOnStep, type ParentRow } from './runView.ts';

// The parts of a session's view that a pipeline run adds (#179): in the parent, the run's own rows after the
// conversation; in a step's sub-session, the way back to the run, the read-only line, the round and the verdict.

/** Where a sub-session's run is: the parent to go back to (a session, or the run row), and its title. */
export function useRunParent(sessionId: string): { id: string; title: string; state: PipelineRunState; index: number; round: number } | null {
  const step = useRunOfStep(sessionId);
  const parentId = step ? (step.state.run.parentSessionId ?? step.state.run.id) : null;
  const parentTitle = useSessions((s) => (parentId ? (s.sessions.get(parentId)?.title ?? null) : null));
  if (!step || !parentId) return null;
  return { id: parentId, title: parentTitle ?? step.state.run.title, state: step.state, index: step.index, round: step.round };
}

/** "Add a usage cost toggle ›" before a sub-session's state line, as a link back to the run. */
export function StepCrumb({ sessionId }: { sessionId: string }) {
  const parent = useRunParent(sessionId);
  if (!parent) return null;
  return (
    <button
      type="button"
      className="no-drag min-w-0 shrink truncate text-muted hover:text-text hover:underline @max-[860px]:hidden"
      onClick={() => useSessions.getState().select(parent.id)}
      data-tooltip="Back to the run"
      data-step-crumb={parent.id}
    >
      {parent.title} ›
    </button>
  );
}

/** Back to the run, in a sub-session's header: opens the parent, or the run row. */
export function BackToRunButton({ sessionId }: { sessionId: string }) {
  const parent = useRunParent(sessionId);
  if (!parent) return null;
  return (
    <Button className="no-drag shrink-0" icon={<ArrowUp size={13} aria-hidden />} onClick={() => useSessions.getState().select(parent.id)} data-back-to-run={parent.id}>
      <span className="@max-[560px]:sr-only">Back to the run</span>
    </Button>
  );
}

/**
 * The top of a step's conversation: the read-only line for a step that can't edit, and the round of a step with a
 * verdict ("Round 2 · started 14:21").
 */
export function StepTopLines({ sessionId }: { sessionId: string }) {
  const parent = useRunParent(sessionId);
  if (!parent) return null;
  const step = parent.state.run.pipeline.steps[parent.index];
  const readOnly = step?.kind === 'claude' && step.readOnly;
  const round = roundDivider(parent.state, parent.index, parent.round);
  if (!readOnly && !round) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-1 px-6 pt-3 pb-2 @max-[860px]:px-4" data-step-top>
      {readOnly && (
        <p className="flex items-center gap-1.5 text-meta text-muted" data-step-read-only>
          <Eye size={13} className="shrink-0" aria-hidden />
          {READ_ONLY_LINE}
        </p>
      )}
      {round && (
        <p className="text-center text-meta text-muted" data-step-round={parent.round}>
          {round}
        </p>
      )}
    </div>
  );
}

/** A verdict item's own Markdown (bold, code, links), without the paragraph around it: it sits inside a list item. */
const VERDICT_ITEM_COMPONENTS = { ...markdownComponents, p: ({ children }: { children?: React.ReactNode }) => <Fragment>{children}</Fragment> };

/** The last thing Claude said in the conversation, for its verdict. */
function lastReplyOf(items: readonly DisplayItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'text' && !item.subagent) return item.text;
    if (item.kind === 'user' && !item.subagent) return null;
  }
  return null;
}

/**
 * A step's verdict (#179), read from its last reply, as a card at the end of its round: the pill, the list, and what
 * the run does with it. Announced when it comes in.
 */
export function StepVerdictCard({ sessionId, items, working }: { sessionId: string; items: readonly DisplayItem[]; working: boolean }) {
  const parent = useRunParent(sessionId);
  const reply = useMemo(() => (working ? null : lastReplyOf(items)), [items, working]);
  const view = parent ? verdictView(parent.state, parent.index, parent.round, reply) : null;
  return (
    <div aria-live="polite">
      {view && (
        <section
          className={`mt-3 select-text rounded-xl border px-3.5 py-3 ${view.verdict.kind === 'pass' ? 'border-ok/50 bg-ok/5' : 'border-caution/50 bg-caution/5'}`}
          aria-label={view.verdict.kind === 'pass' ? 'Verdict: pass' : 'Verdict: changes needed'}
          data-verdict={view.verdict.kind}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={view.verdict.kind === 'pass' ? 'ok' : 'caution'}>{view.verdict.kind === 'pass' ? 'Verdict: pass' : 'Verdict: changes needed'}</Pill>
            <span className="text-meta text-muted">read from the last reply</span>
            <span className="ml-auto text-meta text-muted">{view.round}</span>
          </div>
          {view.verdict.items.length > 0 && (
            <ol className="mt-2 list-decimal pl-5 text-body text-text">
              {view.verdict.items.map((item, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={VERDICT_ITEM_COMPONENTS}>
                    {item}
                  </ReactMarkdown>
                </li>
              ))}
            </ol>
          )}
          {view.next && (
            <p className="mt-2 flex items-center gap-1.5 text-ui text-muted" data-verdict-next>
              <ArrowUp size={12} className="shrink-0" aria-hidden />
              {view.next.to ? (
                <span>
                  Sent to <strong className="font-semibold text-text">{view.next.to}</strong> {view.next.text}
                </span>
              ) : (
                view.next.text
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** The run's stop in the step it stopped at, above its message box. */
export function StepStopNotice({ sessionId }: { sessionId: string }) {
  const parent = useRunParent(sessionId);
  const runId = parent?.state.run.id ?? '';
  const busy = usePipelines((s) => s.busy.has(runId));
  if (!parent || !waitsOnStep(parent.state, parent.index, parent.round)) return null;
  const notice = stopNotice(parent.state);
  if (!notice) return null;
  // A verdict still asking for changes after its rounds: Another round is right here, in the step that found them.
  const actions = notice.anotherRound && (
    <Button size="sm" icon={<Repeat size={12} aria-hidden />} onClick={() => void anotherRound(runId)} disabled={busy} aria-busy={busy || undefined} data-run-another-round>
      {busy ? 'Sending…' : 'Another round'}
    </Button>
  );
  return <RunStopNotice notice={notice} actions={actions || undefined} />;
}

/** The step tree above a run parent's conversation; it scrolls on its own when the pane is short. */
export function ParentStepTree({ sessionId }: { sessionId: string }) {
  const state = useRunOfParent(sessionId);
  if (!state) return null;
  return (
    <div className="mx-auto max-h-[45%] w-full max-w-3xl shrink-0 overflow-y-auto px-6 pt-3 @max-[860px]:px-4">
      <StepTreeCard state={state} />
    </div>
  );
}

/** The message box's placeholder for a run's parent, or a step that waits for you; null for any other session. */
export function useRunPlaceholder(sessionId: string): string | null {
  const parentRun = useRunOfParent(sessionId);
  const step = useRunParent(sessionId);
  if (parentRun) return PARENT_PLACEHOLDER;
  if (step && waitsOnStep(step.state, step.index, step.round)) return replyToStepPlaceholder(step.state.run.pipeline.steps[step.index]?.name ?? 'the step');
  return null;
}

const ROW_ICON = {
  ok: <CircleCheck size={16} className="shrink-0 text-ok" aria-hidden />,
  caution: <CircleAlert size={16} className="shrink-0 text-caution" aria-hidden />,
  error: <CircleX size={16} className="shrink-0 text-error" aria-hidden />,
  muted: <CircleMinus size={16} className="shrink-0 text-faint" aria-hidden />,
} as const;

const ROW_BORDER = { ok: 'border-border', caution: 'border-caution/50', error: 'border-error/50', muted: 'border-border' } as const;

/**
 * Switchboard's own rows in a run's parent, after the conversation (#179): "You started <pipeline> · 14:02", then a
 * dashed row per finished step with Open. They are for you: Claude never gets them.
 */
export function ParentRunRows({ sessionId }: { sessionId: string }) {
  const state = useRunOfParent(sessionId);
  const rows = useMemo(() => (state ? parentRows(state) : []), [state]);
  if (!rows.length) return null;
  return (
    <ol className="mx-auto flex max-w-3xl flex-col gap-2 px-6 pt-3 pb-2" aria-label="The run’s steps" data-run-rows>
      {rows.map((row) => (
        <ParentRowView key={row.key} row={row} />
      ))}
    </ol>
  );
}

function ParentRowView({ row }: { row: ParentRow }) {
  if (row.kind === 'start') {
    return (
      <li className="flex min-w-0 items-center gap-2 text-ui text-muted" data-run-started>
        <ListTree size={14} className="shrink-0 text-pipeline" aria-hidden />
        <span className="min-w-0 truncate">
          You started <strong className="font-semibold text-text">{row.pipeline}</strong> · {row.at}
        </span>
      </li>
    );
  }
  const sessionId = row.sessionId;
  return (
    <li className={`flex min-w-0 items-center gap-2.5 rounded-xl border border-dashed px-3 py-2 ${ROW_BORDER[row.tone]}`} data-run-step-row={row.key}>
      {ROW_ICON[row.tone]}
      <span className="min-w-0 flex-1 truncate text-ui text-muted">
        <strong className="font-semibold text-text">{row.head}</strong>
        {row.rest && ` · ${row.rest}`}
      </span>
      {sessionId && (
        <button type="button" className="shrink-0 text-ui text-link hover:underline" onClick={() => useSessions.getState().select(sessionId)} data-run-row-open={sessionId}>
          Open
        </button>
      )}
      <span className="shrink-0 text-meta text-faint @max-[560px]:hidden">not sent to Claude</span>
    </li>
  );
}
