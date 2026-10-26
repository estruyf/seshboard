import type { BackgroundTask } from '@seshboard/protocol/client';
import type { DisplayItem } from './displayItems.ts';
import type { ToolItem } from './ToolDetails.tsx';

/** How a background command ended, as Claude Code reports it. */
export type CommandState = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';

export interface CommandRun {
  item: ToolItem;
  /** Claude Code's id for it: the id its background task has too. */
  taskId: string;
  kind: 'shell' | 'monitor';
  /** The command line, as Claude wrote it. */
  command: string | null;
  /** What it does, in a few words: Claude's description, else the command. */
  what: string;
  /** The file Claude Code writes its output to. */
  outputFile: string | null;
  state: CommandState;
  /** From Claude Code's last word on it, when it said. */
  exitCode: number | null;
  /** That last word ("… failed with exit code 1", "… was stopped after reaching its background time limit"). */
  summary: string | null;
  /** When it ended, when it did. */
  endedAt: number | null;
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const SHELL_STARTED = /\bwith ID: ([\w-]+)/;
const MONITOR_STARTED = /^Monitor started \(task ([\w-]+)/;
// The path runs to `.output`; in the saved form a full stop and the next sentence follow it.
const OUTPUT_FILE = /Output is being written to: (.+?\.output)(?=\.?\s|\.?$)/;

const stringField = (input: unknown, name: string): string | null => {
  const value = (input as Record<string, unknown> | null)?.[name];
  return typeof value === 'string' && value.trim() ? value : null;
};

/** The task id of a call that started a background command or monitor, else null. */
export function backgroundTaskOf(item: ToolItem): string | null {
  if (!item.result || item.result.isError) return null;
  if (SHELL_TOOLS.has(item.name)) return SHELL_STARTED.exec(item.result.text)?.[1] ?? null;
  if (item.name === 'Monitor') return MONITOR_STARTED.exec(item.result.text)?.[1] ?? null;
  return null;
}

const STATES: Record<string, CommandState> = { completed: 'completed', failed: 'failed', killed: 'stopped', stopped: 'stopped' };

/** Monitors don't say where their output goes; it is next to the other tasks' output, in the session's tasks folder. */
function siblingOutput(known: string | null, taskId: string): string | null {
  if (!known) return null;
  const cut = Math.max(known.lastIndexOf('/'), known.lastIndexOf('\\'));
  return cut === -1 ? null : `${known.slice(0, cut + 1)}${taskId}.output`;
}

/**
 * The commands Claude ran in the background in this session (shell commands and monitors), in the order they started,
 * and how each ended. One counts as running until Claude Code reports its end; the session's live task list, when
 * there is one, has the last word (a command that ended while nothing listened leaves it). Nothing runs in a closed session.
 */
export function commandRuns(items: readonly DisplayItem[], sessionOpen: boolean, live: readonly BackgroundTask[] | null): CommandRun[] {
  const ends = new Map<string, Extract<DisplayItem, { kind: 'agent-report' }>>();
  for (const item of items) if (item.kind === 'agent-report' && !item.progress) ends.set(item.agentId, item);
  const liveIds = live ? new Set(live.map((t) => t.taskId)) : null;

  const found: Array<Pick<CommandRun, 'item' | 'taskId' | 'kind' | 'command' | 'what' | 'outputFile'>> = [];
  for (const item of items) {
    if (item.kind !== 'tool' || item.subagent) continue;
    const taskId = backgroundTaskOf(item);
    if (!taskId) continue;
    const description = stringField(item.input, 'description');
    const command = stringField(item.input, 'command');
    const monitor = item.name === 'Monitor';
    found.push({
      item,
      taskId,
      kind: monitor ? 'monitor' : 'shell',
      command,
      what: description ?? command ?? (monitor ? 'Monitor' : 'Shell command'),
      outputFile: monitor ? null : (OUTPUT_FILE.exec(item.result!.text)?.[1] ?? null),
    });
  }
  const knownFile = found.find((f) => f.outputFile)?.outputFile ?? null;

  return found.map((run) => {
    const end = ends.get(run.taskId);
    const reported = end ? (STATES[end.status] ?? 'unknown') : null;
    const running = sessionOpen && !end && (liveIds ? liveIds.has(run.taskId) : true);
    const state: CommandState = running ? 'running' : (reported ?? 'unknown');
    const exitCode = end ? Number(/exit code (-?\d+)/.exec(end.title)?.[1] ?? NaN) : NaN;
    return {
      ...run,
      outputFile: run.outputFile ?? siblingOutput(knownFile, run.taskId),
      state,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      summary: end?.title ?? null,
      endedAt: end?.at ?? null,
    };
  });
}

/** The command a background task (the strip above the message box) stands for. */
export const commandForTask = (task: BackgroundTask, runs: readonly CommandRun[]): CommandRun | undefined => runs.find((run) => run.taskId === task.taskId);

/** Running commands first, each group newest first as given. */
export function splitCommands(runs: readonly CommandRun[]): { active: CommandRun[]; finished: CommandRun[] } {
  return { active: runs.filter((run) => run.state === 'running'), finished: runs.filter((run) => run.state !== 'running') };
}

/** The command the panel shows: the one picked if it is still there, else the newest running one, else the newest. */
export function shownCommand(runs: readonly CommandRun[], picked: string | null): CommandRun | undefined {
  return runs.find((run) => run.taskId === picked) ?? runs.find((run) => run.state === 'running') ?? runs[0];
}

// Colours, cursor moves and the like: the panel shows output as plain text.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Output as it would read in a terminal, roughly: escape codes gone, and a line redrawn with `\r` shows its last form. */
export function plainOutput(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.includes('\r') ? (line.split('\r').filter(Boolean).at(-1) ?? '') : line))
    .join('\n');
}
