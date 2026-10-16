import { describe, expect, it } from 'vitest';
import { agentReport, type DisplayItem } from './displayItems.ts';
import { commandForTask, commandRuns, plainOutput, shownCommand, splitCommands } from './commandRuns.ts';

const WIN_DIR = 'C:\\Users\\me\\AppData\\Local\\Temp\\claude\\E--repos-demo\\5305d406\\tasks';
const started = (id: string, dir = WIN_DIR) =>
  `Command running in background with ID: ${id}. Output is being written to: ${dir}\\${id}.output. You will be notified when it completes. To check interim output, use Read.`;

const call = (key: string, name: string, input: Record<string, unknown>, result: string | null, isError = false): DisplayItem => ({
  kind: 'tool',
  key,
  at: null,
  id: key,
  name,
  input,
  inputTruncated: false,
  result: result === null ? null : { text: result, isError, truncated: false, images: [], at: null },
  subagent: false,
});
const end = (taskId: string, status: string, summary: string, at: number | null = 5): DisplayItem => ({ kind: 'agent-report', key: `end-${taskId}`, at, agentId: taskId, toolUseId: null, status, title: summary, text: summary });
const task = (taskId: string) => ({ taskId, type: 'local_bash', description: '', startedAt: 0 });

describe('commandRuns', () => {
  it('finds background shell commands, with their command, description and output file', () => {
    const items = [
      call('fg', 'Bash', { command: 'ls' }, 'a.txt'),
      call('bg', 'Bash', { command: 'npm run build', description: 'Build the app', run_in_background: true }, started('b1')),
      call('ps', 'PowerShell', { command: 'Get-ChildItem' }, started('b2')),
    ];
    const runs = commandRuns(items, true, null);
    expect(runs.map((r) => [r.taskId, r.kind, r.what, r.command])).toEqual([
      ['b1', 'shell', 'Build the app', 'npm run build'],
      ['b2', 'shell', 'Get-ChildItem', 'Get-ChildItem'],
    ]);
    expect(runs[0]!.outputFile).toBe(`${WIN_DIR}\\b1.output`);
  });

  it('reads the output file on macOS too', () => {
    const [run] = commandRuns([call('bg', 'Bash', { command: 'sleep 5' }, started('b1', '/private/tmp/claude-501/-Users-me/abc/tasks').replaceAll('\\', '/'))], true, null);
    expect(run!.outputFile).toBe('/private/tmp/claude-501/-Users-me/abc/tasks/b1.output');
  });

  it('runs until Claude Code reports the end, with the exit code', () => {
    const items = [
      call('a', 'Bash', { command: 'a' }, started('b1')),
      call('b', 'Bash', { command: 'b' }, started('b2')),
      call('c', 'Bash', { command: 'c' }, started('b3')),
      call('d', 'Bash', { command: 'd' }, started('b4')),
      end('b1', 'completed', 'Background command "a" completed (exit code 0)'),
      end('b2', 'failed', 'Background command "b" failed with exit code 1'),
      end('b3', 'killed', 'Background command "c" was stopped after reaching its background time limit'),
    ];
    expect(commandRuns(items, true, null).map((r) => [r.taskId, r.state, r.exitCode])).toEqual([
      ['b1', 'completed', 0],
      ['b2', 'failed', 1],
      ['b3', 'stopped', null],
      ['b4', 'running', null],
    ]);
    // Nothing runs in a session that isn't open.
    expect(commandRuns(items, false, null).find((r) => r.taskId === 'b4')!.state).toBe('unknown');
  });

  it('trusts the live task list over a missing report', () => {
    const items = [call('a', 'Bash', { command: 'a' }, started('b1')), call('b', 'Bash', { command: 'b' }, started('b2'))];
    expect(commandRuns(items, true, [task('b2')]).map((r) => r.state)).toEqual(['unknown', 'running']);
  });

  it('finds monitors, their output next to the other tasks, and keeps them running through their events', () => {
    const monitor = call('m', 'Monitor', { command: 'tail -f log', description: 'Watch the log' }, 'Monitor started (task bm1, expires in 15m unless the source ends first).');
    const event = agentReport('<task-notification>\n<task-id>bm1</task-id>\n<summary>Monitor event: "Watch the log"</summary>\n<event>ready</event>\n</task-notification>')!;
    const items = [call('a', 'Bash', { command: 'a' }, started('b1')), monitor, { kind: 'agent-report', key: 'e', at: null, ...event } as DisplayItem];
    const run = commandRuns(items, true, null).find((r) => r.kind === 'monitor')!;
    expect(run).toMatchObject({ taskId: 'bm1', what: 'Watch the log', state: 'running', outputFile: `${WIN_DIR}\\bm1.output` });
  });

  it('skips failed calls and calls inside an agent', () => {
    const inside = { ...call('s', 'Bash', { command: 'x' }, started('b9')), subagent: true } as DisplayItem;
    expect(commandRuns([call('e', 'Bash', { command: 'x' }, started('b1'), true), inside], true, null)).toEqual([]);
  });

  it('picks, splits and matches tasks', () => {
    const runs = commandRuns([call('a', 'Bash', { command: 'a' }, started('b1')), call('b', 'Bash', { command: 'b' }, started('b2')), end('b1', 'completed', 'done')], true, null).reverse();
    expect(splitCommands(runs).active.map((r) => r.taskId)).toEqual(['b2']);
    expect(shownCommand(runs, null)?.taskId).toBe('b2');
    expect(shownCommand(runs, 'b1')?.taskId).toBe('b1');
    expect(shownCommand(runs, 'gone')?.taskId).toBe('b2');
    expect(commandForTask(task('b1'), runs)?.taskId).toBe('b1');
    expect(commandForTask(task('zz'), runs)).toBeUndefined();
  });
});

describe('plainOutput', () => {
  it('drops escape codes and keeps the last form of a redrawn line', () => {
    expect(plainOutput('\u001b[32m✓ built\u001b[39m\r\n')).toBe('✓ built\n');
    expect(plainOutput('10%\r50%\r100%\ndone')).toBe('100%\ndone');
  });
});
