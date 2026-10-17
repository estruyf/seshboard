import { Bot, CircleAlert, Square, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { BackgroundTask } from '@switchboard/protocol/client';
import { useAgentsPanel } from '../../state/agentsPanelStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { formatDuration, useTicker } from '../transcript/ActivityGroup.tsx';
import { agentModel, shownAgent, splitAgents, taskForAgent, type AgentRun } from '../transcript/agentRuns.ts';
import { Markdown } from '../transcript/Markdown.tsx';
import { SubagentRun } from '../transcript/SubagentRun.tsx';
import type { AgentTokens } from '../transcript/turns.ts';
import { modelTitle } from '../transcript/turnFormat.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

interface AgentsPanelProps {
  sessionId: string;
  cwd: string | null;
  /** Newest first. */
  runs: AgentRun[];
  /** What each agent used, by its call's id: where the model it actually ran on comes from. */
  tokens: ReadonlyMap<string, AgentTokens> | undefined;
  /** What the session keeps running in the background: a background agent's task is what Stop ends. */
  tasks: BackgroundTask[];
  /** The agent on show (a tool call id), when one was picked. */
  picked: string | null;
  onPick(agent: string): void;
  onStop(taskId: string): Promise<void>;
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the title, with the panel's buttons on its right. */
  tabs?: (actions: ReactNode) => ReactNode;
  onClose(): void;
}

function StateIcon({ run }: { run: AgentRun }) {
  const failed = run.item.result?.isError ?? false;
  if (run.running) return <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" aria-hidden />;
  if (failed) return <CircleAlert size={13} className="shrink-0 text-error" aria-hidden />;
  return <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />;
}

const stateWord = (run: AgentRun) => (run.running ? 'Running' : run.item.result?.isError ? 'Failed' : 'Finished');

/** A background agent's call returns at once and its own run ends with its report, which we don't time. */
const endOf = (run: AgentRun, now: number) => (run.running ? now : run.background ? null : (run.item.result?.at ?? null));

function AgentRow({ run, model, selected, now, onPick }: { run: AgentRun; model: string | null; selected: boolean; now: number; onPick(): void }) {
  const end = endOf(run, now);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected || undefined}
      className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-ui ${selected ? 'border-accent-ink bg-border/40' : 'border-transparent hover:bg-border/30'}`}
      data-agent-row={run.item.id}
      data-agent-run={run.running ? 'running' : 'done'}
    >
      <StateIcon run={run} />
      <span className="sr-only">{stateWord(run)}: </span>
      <span className="min-w-0 flex-1 truncate">{run.what}</span>
      <span className="shrink-0 rounded bg-border/60 px-1.5 text-meta text-muted" data-tooltip="Agent type">
        {run.type}
      </span>
      {model && (
        <span className="shrink-0 rounded bg-border/60 px-1.5 text-meta text-muted" data-tooltip="Model" data-agent-model>
          {modelTitle(model)}
        </span>
      )}
      {run.item.at !== null && end !== null && <span className="shrink-0 text-meta text-muted tabular-nums">{formatDuration(end - run.item.at)}</span>}
    </button>
  );
}

function AgentDetail({ run, model, sessionId, cwd, task, now, onStop }: { run: AgentRun; model: string | null; sessionId: string; cwd: string | null; task: BackgroundTask | undefined; now: number; onStop(taskId: string): Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const end = endOf(run, now);
  const stop = async () => {
    if (!task) return;
    setStopping(true);
    try {
      await onStop(task.taskId);
    } catch {
      setStopping(false);
    }
  };
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 px-3 py-3" data-agent-detail={run.item.id}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-body font-semibold break-words">{run.what}</h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
            <span className="inline-flex items-center gap-1.5">
              <StateIcon run={run} />
              {stateWord(run)}
            </span>
            <span>{run.type}</span>
            {model && <span data-agent-model>{modelTitle(model)}</span>}
            {run.background && <span data-tooltip="Runs in the background while Claude carries on">background</span>}
            {run.item.at !== null && end !== null && <span className="tabular-nums">{formatDuration(end - run.item.at)}</span>}
          </div>
        </div>
        {task && (
          <Button variant="quiet" size="sm" icon={<Square size={11} aria-hidden />} disabled={stopping} onClick={() => void stop()} aria-label={`Stop ${run.what}`} data-tooltip="Stop this agent" data-agent-stop>
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>

      {run.prompt && (
        <details className="group rounded-lg border border-border bg-card" data-agent-prompt>
          <summary className="cursor-pointer px-3 py-1.5 text-meta font-semibold tracking-wider text-muted uppercase select-none">Prompt</summary>
          <p className="max-h-48 overflow-y-auto border-t border-border px-3 py-2 text-ui break-words whitespace-pre-wrap select-text">{run.prompt}</p>
        </details>
      )}

      {!run.running && run.report && (
        <section aria-label="Report" className="min-w-0 rounded-lg border border-border bg-card px-3 py-2" data-agent-report>
          <h4 className="mb-1 text-meta font-semibold tracking-wider text-muted uppercase">Report</h4>
          <div className="text-ui select-text">
            <Markdown text={run.report} />
          </div>
        </section>
      )}

      <section aria-label="What it did" className="min-w-0">
        <h4 className="mb-1 text-meta font-semibold tracking-wider text-muted uppercase">{run.running ? 'Working' : 'Work'}</h4>
        <SubagentRun sessionId={sessionId} toolUseId={run.item.id} running={run.running} cwd={cwd} fill />
      </section>
    </div>
  );
}

/**
 * The agents Claude started in this session, on the right next to the conversation (a tab beside Changes and Ask): the
 * running ones and the finished ones as two folding lists, and under them what the one picked is doing, what it was
 * asked, what it reported and, for a background agent, a Stop button.
 */
export function AgentsPanel(props: AgentsPanelProps) {
  const { sessionId, runs } = props;
  const modelOf = (run: AgentRun) => agentModel(run, props.tokens?.get(run.item.id));
  const asideRef = useRef<HTMLElement>(null);
  const sections = useAgentsPanel((s) => s.sections);
  const toggleSection = useAgentsPanel((s) => s.toggleSection);
  const { active, finished } = splitAgents(runs);
  const now = useTicker(active.length > 0) || Date.now();
  const shown = shownAgent(runs, props.picked);
  // ↑ ↓ walk the visible rows, in the order they show.
  const visible = [...(sections.active ? active : []), ...(sections.finished ? finished : [])];

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
      event.preventDefault();
      props.onClose();
    }
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const at = visible.findIndex((run) => run.item.id === shown?.item.id);
    const next = visible[Math.min(visible.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    event.preventDefault();
    props.onPick(next.item.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-agent-row="${CSS.escape(next.item.id)}"]`)?.focus());
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = props.width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => props.onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, props.width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    props.onWidth(next);
  };

  const actions = <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close agents" shortcut="agents.toggle" onClick={props.onClose} data-agents-close />;
  const summary = `${active.length} running${finished.length ? ` · ${finished.length} finished` : ''}`;

  const list = (title: string, tone: 'working' | 'neutral', key: 'active' | 'finished', rows: AgentRun[]) =>
    rows.length > 0 && (
      <section aria-label={title} data-agents-section={key}>
        <SectionHeader tone={tone} count={rows.length} className="h-7 px-3" toggle={{ expanded: sections[key], onToggle: () => toggleSection(key), data: { 'data-agents-section-toggle': key } }}>
          {title}
        </SectionHeader>
        {sections[key] && rows.map((run) => <AgentRow key={run.item.key} run={run} model={modelOf(run)} selected={run.item.id === shown?.item.id} now={now} onPick={() => props.onPick(run.item.id)} />)}
      </section>
    );

  return (
    <aside ref={asideRef} aria-label="Agents" tabIndex={-1} onKeyDown={onPanelKey} className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none" style={{ width: props.width }} data-agents-panel>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Agents panel width"
        aria-valuenow={props.width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
        data-tooltip="Drag (or use ← →) to resize"
        data-agents-resize
      />
      {props.tabs ? (
        props.tabs(actions)
      ) : (
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 pt-2.5 pb-2">
          <Bot size={16} aria-hidden className="mt-0.5 shrink-0 text-accent-ink" />
          <div className="grid min-w-0 flex-1">
            <h2 className="truncate text-ui font-semibold text-text">Agents</h2>
            <span className="text-meta text-muted" data-agents-summary>
              {summary}
            </span>
          </div>
          {actions}
        </header>
      )}

      {runs.length === 0 ? (
        <p className="p-4 text-ui text-muted">No agents in this session.</p>
      ) : (
        <>
          {props.tabs && (
            <p className="shrink-0 border-b border-border px-3 py-1 text-meta text-muted" data-agents-summary>
              {summary}
            </p>
          )}
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1" onKeyDown={onListKey} data-agents-list>
            {list('Active', 'working', 'active', active)}
            {list('Finished', 'neutral', 'finished', finished)}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            {shown && <AgentDetail key={shown.item.id} run={shown} model={modelOf(shown)} sessionId={sessionId} cwd={props.cwd} task={taskForAgent(shown, props.tasks)} now={now} onStop={props.onStop} />}
          </div>
        </>
      )}
    </aside>
  );
}
