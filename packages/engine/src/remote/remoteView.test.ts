import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, type Pipeline, type PipelineRunState, type SessionSummary, type TranscriptMessage } from '@switchboard/protocol';
import { projectIdOf, remoteMessage, remoteRuns, remoteSessions } from './remoteView.ts';

const msg = (role: TranscriptMessage['role'], blocks: TranscriptMessage['blocks']): TranscriptMessage => ({ uuid: 'm1', role, timestamp: 1, parentToolUseId: null, model: null, blocks });
const user = (text: string) => remoteMessage(msg('user', [{ type: 'text', text }]));

describe('remoteMessage usage', () => {
  it('sends the tokens of a reply under the response id, for the phone to count per turn', () => {
    const reply: TranscriptMessage = { ...msg('assistant', [{ type: 'text', text: 'Done.' }]), model: 'claude-opus-5-5', usage: { id: 'resp-1', input: 10, output: 5, cacheRead: 100, cacheCreation: 2 } };
    expect(remoteMessage(reply)).toMatchObject({ usage: { id: 'resp-1', input: 10, output: 5, cacheRead: 100, cacheWrite: 2 } });
  });

  it('leaves usage out when Claude Code reported none', () => {
    expect(remoteMessage(msg('assistant', [{ type: 'text', text: 'Done.' }]))).not.toHaveProperty('usage');
  });
});

describe('remoteMessage', () => {
  it('turns a background task finishing into a line from Claude Code', () => {
    const notification =
      '<task-notification>\n<task-id>blup0q1xu</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/tasks/blup0q1xu.output</output-file>\n<status>failed</status>\n<summary>Background command "Wait for PR checks to finish" failed with exit code 1</summary>\n</task-notification>';
    expect(user(notification)).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Background command "Wait for PR checks to finish" failed with exit code 1' }] });
    expect(user('Another Claude session sent a message:\n<agent-message from="a1">The report follows:\n  Done.\n</agent-message>')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'An agent reported back' }] });
  });

  it('reads slash commands, command output and interrupts as the app does', () => {
    expect(user('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>--fast</command-args>')).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: '/review --fast' }] });
    expect(user('<local-command-stdout>Compacted</local-command-stdout>')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Compacted' }] });
    expect(user('<local-command-stdout></local-command-stdout>')).toMatchObject({ role: 'system', blocks: [] });
    expect(user('[Request interrupted by user]')).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Interrupted by you' }] });
  });

  it('drops reminders and names what a system turn marks', () => {
    expect(user('Fix it<system-reminder>secret</system-reminder>')).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] });
    expect(user('<system-reminder>secret</system-reminder>').blocks).toEqual([]);
    expect(remoteMessage(msg('system', [{ type: 'unknown', kind: 'compact_boundary' }]))).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'Conversation compacted' }] });
    // A tool result is left alone, even when its output looks like markup.
    const result = remoteMessage(msg('user', [{ type: 'tool_result', toolUseId: 't', isError: false, text: '<task-notification>', truncated: false, images: [] }]));
    expect(result.role).toBe('user');
  });
});

const ROOT = '/work/web';
const WORKTREE = '/work/.worktrees/web-quiet-river';
const DAY = 86_400_000;
const NOW = 100 * DAY;

/** A run of the built-in pipeline, at Validate, with two finished steps. */
function runState(over: Partial<PipelineRunState['run']> = {}): PipelineRunState {
  const pipeline: Pipeline = { ...BUILT_IN_PIPELINES[0]!, scope: { kind: 'project', root: ROOT }, builtIn: true, createdAt: 1, updatedAt: 1 };
  const step = (index: number, sessionId: string) => ({
    runId: 'run-1',
    step: pipeline.steps[index]!.name,
    index,
    round: 1,
    sessionId,
    status: 'done' as const,
    outcome: 'clean' as const,
    verdict: null,
    reason: null,
    plan: index === 0 ? 'The secret plan' : null,
    actions: [{ name: 'Test', exitCode: 0, tail: `${ROOT}/src passed`, ms: 5 }],
    startedAt: NOW - 3_000,
    endedAt: NOW - 2_000,
  });
  return {
    run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: 'parent', task: null, title: 'Add a toggle', projectRoot: ROOT, cwd: WORKTREE, profileId: 'work', status: 'running', reason: null, waitingFor: null, hold: null, step: 2, round: 1, sentBackTo: null, pr: null, unattended: false, createdAt: NOW - 5_000, updatedAt: NOW - 1_000, endedAt: null, archivedAt: null, restoredAt: null, ...over },
    steps: [step(0, 'plan'), step(1, 'execute')],
  };
}

describe('remoteRuns', () => {
  const options = { projectNames: new Map([[ROOT, 'Web']]), archiveAfterDays: 7, now: NOW };

  it('sends a run without its folders, its profile, the plan or the actions’ output', () => {
    const [remote] = remoteRuns([runState()], new Set(['parent']), options);
    expect(remote!.run).toMatchObject({ id: 'run-1', projectId: projectIdOf(ROOT), projectName: 'Web', worktree: true, title: 'Add a toggle' });
    expect(remote!.run).not.toHaveProperty('projectRoot');
    expect(remote!.run).not.toHaveProperty('cwd');
    expect(remote!.run).not.toHaveProperty('profileId');
    expect(remote!.run.pipeline).not.toHaveProperty('scope');
    expect(remote!.steps[0]).not.toHaveProperty('plan');
    expect(remote!.steps[0]).not.toHaveProperty('actions');
    expect(JSON.stringify(remote)).not.toContain(ROOT);
    expect(JSON.stringify(remote)).not.toContain('The secret plan');
  });

  it('sends the runs of what the phone lists, and the run rows the sidebar lists', () => {
    const hidden = runState({ id: 'run-hidden', parentSessionId: 'elsewhere' });
    const viaChild = runState({ id: 'run-child', parentSessionId: 'elsewhere' });
    viaChild.steps = [{ ...viaChild.steps[0]!, sessionId: 'listed-child' }];
    const row = runState({ id: 'run-row', parentSessionId: null, task: 'Add a toggle', status: 'done', updatedAt: NOW - DAY });
    const oldRow = runState({ id: 'run-old', parentSessionId: null, status: 'done', updatedAt: NOW - 30 * DAY });
    const archivedRow = runState({ id: 'run-archived', parentSessionId: null, status: 'stopped', archivedAt: NOW - 500 });
    // A run row that waits for you stays, however old: as a session that needs you.
    const waitingRow = runState({ id: 'run-waiting', parentSessionId: null, status: 'waiting', waitingFor: 'push', updatedAt: NOW - 30 * DAY });
    const ids = remoteRuns([hidden, viaChild, row, oldRow, archivedRow, waitingRow, runState()], new Set(['parent', 'listed-child']), options).map((r) => r.run.id);
    expect(ids.sort()).toEqual(['run-1', 'run-child', 'run-row', 'run-waiting']);
  });
});

describe('remoteSessions with runs', () => {
  const summary = (id: string, parentId: string | null) =>
    ({ id, title: id, customTitle: null, cwd: ROOT, projectRoot: ROOT, gitBranch: null, worktree: null, updatedAt: NOW, unread: false, pinned: false, archivedAt: null, restoredAt: null, inApp: true, profileId: null, parentId }) as unknown as SessionSummary;

  it('puts a step under its parent, also before its transcript says so', () => {
    const list = remoteSessions({ summaries: [summary('parent', null), summary('plan', 'parent'), summary('execute', null)], live: [], hosts: [] }, { archiveAfterDays: 7, scope: 'switchboard', projectNames: new Map(), runs: [runState()], now: NOW });
    expect(Object.fromEntries(list.sessions.map((s) => [s.id, s.parentId]))).toEqual({ parent: null, plan: 'parent', execute: 'parent' });
    expect(list.runs?.map((r) => r.run.id)).toEqual(['run-1']);
  });

  it('sends no runs from an engine without pipelines', () => {
    const list = remoteSessions({ summaries: [summary('parent', null)], live: [], hosts: [] }, { archiveAfterDays: 7, scope: 'switchboard', projectNames: new Map(), now: NOW });
    expect(list).not.toHaveProperty('runs');
  });
});
