import { CircleAlert, Copy, ScrollText, Square, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { BackgroundTask } from '@switchboard/protocol/client';
import { useCommandsPanel } from '../../state/commandsPanelStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { formatDuration, useTicker } from '../transcript/ActivityGroup.tsx';
import { plainOutput, shownCommand, splitCommands, type CommandRun } from '../transcript/commandRuns.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { useTaskOutput } from './useTaskOutput.ts';

interface CommandsPanelProps {
  sessionId: string;
  /** Newest first. */
  runs: CommandRun[];
  /** What the session keeps running in the background: a running command's task is what Stop ends. */
  tasks: BackgroundTask[];
  /** The command on show (a task id), when one was picked. */
  picked: string | null;
  onPick(taskId: string): void;
  onStop(taskId: string): Promise<void>;
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the title, with the panel's buttons on its right. */
  tabs?: (actions: ReactNode) => ReactNode;
  onClose(): void;
}

function StateIcon({ run }: { run: CommandRun }) {
  if (run.state === 'running') return <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" aria-hidden />;
  if (run.state === 'failed') return <CircleAlert size={13} className="shrink-0 text-error" aria-hidden />;
  if (run.state === 'completed') return <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />;
  return <span className="size-2 shrink-0 rounded-full bg-faint" aria-hidden />;
}

function stateWord(run: CommandRun): string {
  switch (run.state) {
    case 'running':
      return 'Running';
    case 'completed':
      return run.exitCode !== null ? `Finished, exit code ${run.exitCode}` : 'Finished';
    case 'failed':
      return run.exitCode !== null ? `Failed, exit code ${run.exitCode}` : 'Failed';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Ended';
  }
}

/** How long it ran: until now while it runs, until its end once Claude Code reported one. */
const ranFor = (run: CommandRun, now: number) => (run.item.at === null ? null : run.state === 'running' ? now - run.item.at : run.endedAt !== null ? run.endedAt - run.item.at : null);

const KIB = 1024;
const sizeText = (bytes: number) => (bytes < KIB * KIB ? `${Math.max(1, Math.round(bytes / KIB))} KB` : `${(bytes / KIB / KIB).toFixed(1)} MB`);

function CommandRow({ run, selected, now, onPick }: { run: CommandRun; selected: boolean; now: number; onPick(): void }) {
  const ran = ranFor(run, now);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected || undefined}
      className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-ui ${selected ? 'border-accent-ink bg-border/40' : 'border-transparent hover:bg-border/30'}`}
      data-command-row={run.taskId}
      data-command-state={run.state}
    >
      <StateIcon run={run} />
      <span className="sr-only">{stateWord(run)}: </span>
      <span className="min-w-0 flex-1 truncate">{run.what}</span>
      {run.kind === 'monitor' && (
        <span className="shrink-0 rounded bg-border/60 px-1.5 text-meta text-muted" data-tooltip="Watches a command and tells Claude about each line it prints">
          monitor
        </span>
      )}
      {run.exitCode !== null && run.exitCode !== 0 && <span className="shrink-0 text-meta text-error tabular-nums">exit {run.exitCode}</span>}
      {ran !== null && <span className="shrink-0 text-meta text-muted tabular-nums">{formatDuration(ran)}</span>}
    </button>
  );
}

function CommandOutput({ sessionId, run }: { sessionId: string; run: CommandRun }) {
  const out = useTaskOutput(sessionId, run.outputFile, run.state === 'running');
  const text = useMemo(() => plainOutput(out.text), [out.text]);
  const boxRef = useRef<HTMLPreElement>(null);
  // Follows the end while you're at the end; scrolled up to read, it stays where you are.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && atEnd.current) box.scrollTop = box.scrollHeight;
  }, [text]);
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );

  const empty = !run.outputFile
    ? 'Claude Code didn’t say where this command’s output goes.'
    : out.error
      ? `Could not read the output: ${out.error}`
      : !out.loaded
        ? 'Reading the output…'
        : out.missing
          ? run.state === 'running'
            ? 'No output yet.'
            : 'The output is gone: Claude Code cleans up its temporary folder.'
          : !text.trim()
            ? run.state === 'running'
              ? 'No output yet.'
              : 'It printed nothing.'
            : null;

  return (
    <section aria-label="Output" className="flex min-h-0 min-w-0 flex-1 flex-col" data-command-output>
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-meta font-semibold tracking-wider text-muted uppercase">Output</h4>
        {out.truncated && (
          <span className="text-meta text-muted" data-tooltip="Long output: the panel keeps the end of it">
            Last part of {sizeText(out.size)}
          </span>
        )}
        {empty === null && (
          <Button variant="quiet" size="sm" className="ml-auto" icon={<Copy size={12} aria-hidden />} onClick={copy} data-tooltip="Copy the output shown" data-command-copy={copied ? 'copied' : ''}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
      {empty !== null ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-ui text-muted" data-command-output-empty>
          {empty}
        </p>
      ) : (
        <pre
          ref={boxRef}
          tabIndex={0}
          aria-label="Command output"
          onScroll={(event) => {
            const box = event.currentTarget;
            atEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
          }}
          className="min-h-24 flex-1 overflow-auto rounded-lg bg-code px-2.5 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-text select-text"
        >
          {text}
        </pre>
      )}
    </section>
  );
}

function CommandDetail({ run, sessionId, task, now, onStop }: { run: CommandRun; sessionId: string; task: BackgroundTask | undefined; now: number; onStop(taskId: string): Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const ran = ranFor(run, now);
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 py-3" data-command-detail={run.taskId}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-body font-semibold break-words">{run.what}</h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
            <span className={`inline-flex items-center gap-1.5 ${run.state === 'failed' ? 'text-error' : ''}`}>
              <StateIcon run={run} />
              {stateWord(run)}
            </span>
            {run.kind === 'monitor' && <span>Monitor</span>}
            {ran !== null && <span className="tabular-nums">{formatDuration(ran)}</span>}
          </div>
        </div>
        {task && run.state === 'running' && (
          <Button variant="danger" size="sm" icon={<Square size={11} aria-hidden />} disabled={stopping} onClick={() => void stop()} aria-label={`Stop ${run.what}`} data-tooltip="Stop this command" data-command-stop>
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>

      {run.command && (
        <pre className="max-h-32 shrink-0 overflow-auto rounded-lg bg-code px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-muted select-text" data-command-line>
          $ {run.command}
        </pre>
      )}

      {/* Claude Code's own last word, when it says more than the state does (a time limit, a stop). */}
      {run.summary && run.state === 'stopped' && <p className="shrink-0 text-ui text-muted">{run.summary}</p>}

      <CommandOutput sessionId={sessionId} run={run} />
    </div>
  );
}

/**
 * The commands Claude ran in the background in this session, on the right next to the conversation (a tab beside
 * Changes, Ask and Agents): the running ones and the finished ones as two folding lists, and under them the one picked:
 * its command line, how it ended, its output (live while it runs) and a Stop button.
 */
export function CommandsPanel(props: CommandsPanelProps) {
  const { sessionId, runs } = props;
  const sections = useCommandsPanel((s) => s.sections);
  const toggleSection = useCommandsPanel((s) => s.toggleSection);
  const { active, finished } = splitCommands(runs);
  const now = useTicker(active.length > 0) || Date.now();
  const shown = shownCommand(runs, props.picked);
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
    const at = visible.findIndex((run) => run.taskId === shown?.taskId);
    const next = visible[Math.min(visible.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    event.preventDefault();
    props.onPick(next.taskId);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-command-row="${CSS.escape(next.taskId)}"]`)?.focus());
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

  const actions = <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close commands" shortcut="commands.toggle" onClick={props.onClose} data-commands-close />;
  const summary = `${active.length} running${finished.length ? ` · ${finished.length} finished` : ''}`;

  const list = (title: string, tone: 'working' | 'neutral', key: 'active' | 'finished', rows: CommandRun[]) =>
    rows.length > 0 && (
      <section aria-label={title} data-commands-section={key}>
        <SectionHeader tone={tone} count={rows.length} className="h-7 px-3" toggle={{ expanded: sections[key], onToggle: () => toggleSection(key), data: { 'data-commands-section-toggle': key } }}>
          {title}
        </SectionHeader>
        {sections[key] && rows.map((run) => <CommandRow key={run.taskId} run={run} selected={run.taskId === shown?.taskId} now={now} onPick={() => props.onPick(run.taskId)} />)}
      </section>
    );

  return (
    <aside aria-label="Commands" tabIndex={-1} onKeyDown={onPanelKey} className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none" style={{ width: props.width }} data-commands-panel>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Commands panel width"
        aria-valuenow={props.width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
        data-tooltip="Drag (or use ← →) to resize"
        data-commands-resize
      />
      {props.tabs ? (
        props.tabs(actions)
      ) : (
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 pt-2.5 pb-2">
          <ScrollText size={16} aria-hidden className="mt-0.5 shrink-0 text-accent-ink" />
          <div className="grid min-w-0 flex-1">
            <h2 className="truncate text-ui font-semibold text-text">Commands</h2>
            <span className="text-meta text-muted" data-commands-summary>
              {summary}
            </span>
          </div>
          {actions}
        </header>
      )}

      {runs.length === 0 ? (
        <p className="p-4 text-ui text-muted">No background commands in this session.</p>
      ) : (
        <>
          {props.tabs && (
            <p className="shrink-0 border-b border-border px-3 py-1 text-meta text-muted" data-commands-summary>
              {summary}
            </p>
          )}
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1" onKeyDown={onListKey} data-commands-list>
            {list('Running', 'working', 'active', active)}
            {list('Finished', 'neutral', 'finished', finished)}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {shown && <CommandDetail key={shown.taskId} run={shown} sessionId={sessionId} task={props.tasks.find((t) => t.taskId === shown.taskId)} now={now} onStop={props.onStop} />}
          </div>
        </>
      )}
    </aside>
  );
}
