import { describe, expect, it } from 'vitest';
import type { LiveSession, PermissionRequest, SessionHostInfo, TerminalInfo } from '@switchboard/protocol/client';
import { Attention } from './attention.ts';

const host = (state: SessionHostInfo['state'], extra: Partial<SessionHostInfo> = {}): SessionHostInfo => ({
  sessionId: 's1',
  cwd: '/work/app',
  state,
  model: null,
  permissionMode: 'default',
  effort: null,
  costUsd: 0,
  contextPercent: null,
  contextTokens: null,
  contextMax: null,
  error: null,
  startedAt: 0,
  promptedAt: null,
  queue: [], queueHold: null,
  profileId: 'default',
  backgroundTasks: [],
  ...extra,
});

const request = (requestId: string, sessionId = 's1', toolName = 'Bash'): PermissionRequest => ({
  requestId,
  sessionId,
  toolName,
  toolUseId: null,
  input: {},
  title: null,
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: 0,
});

const live = (sessionId: string, status: LiveSession['status'], origin: LiveSession['origin'] = 'cli'): LiveSession => ({
  sessionId,
  pid: 1,
  cwd: '/work/cli',
  projectRoot: '/work/cli',
  status,
  rawStatus: status,
  name: null,
  origin,
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

describe('Attention', () => {
  it('reports a finished turn once, and only after work', () => {
    const a = new Attention();
    a.setTitle('s1', 'Fix login');
    expect(a.onHost(host('idle'))).toEqual([]);
    expect(a.onHost(host('running'))).toEqual([]);
    expect(a.onHost(host('idle'))).toEqual([{ kind: 'finished', sessionId: 's1', title: 'Claude finished', body: 'Fix login · app', cwd: expect.any(String) }]);
    expect(a.onHost(host('idle'))).toEqual([]);
  });

  it('says a usage limit stopped the turn, and when a session resumed after it', () => {
    const a = new Attention();
    a.setTitle('s1', 'Fix login');
    const usageLimit = { profileId: 'default', kind: 'five_hour', resetsAt: null, since: 0, message: null, sessionIds: ['s1'] };
    a.onHost(host('running'));
    expect(a.onHost(host('idle', { usageLimit }))).toEqual([{ kind: 'failed', sessionId: 's1', title: 'Usage limit reached', body: 'Fix login · app' }]);
    expect(a.onResumed('s1')).toEqual([{ kind: 'resumed', sessionId: 's1', title: 'Resumed after the usage limit reset', body: 'Fix login' }]);
  });

  it("says how a session's pull request checks ended", () => {
    const a = new Attention();
    a.setTitle('s1', 'Fix login');
    const pr = { number: 123, url: 'https://github.com/o/r/pull/123' };
    expect(a.onChecksFinished({ sessionId: 's1', path: '/app', branch: 'feat/login', pr, outcome: 'fail', failed: 1, total: 5 })).toEqual([
      { kind: 'checks-failed', sessionId: 's1', title: 'Checks failed on PR #123', body: '1 of 5 checks failed · Fix login' },
    ]);
    expect(a.onChecksFinished({ sessionId: 's2', path: '/app', branch: 'feat/x', pr, outcome: 'pass', failed: 0, total: 3 })).toEqual([
      { kind: 'checks-passed', sessionId: 's2', title: 'Checks passed on PR #123', body: 'All 3 checks passed · feat/x' },
    ]);
  });

  it('names a Windows folder by its last part, not its whole path', () => {
    const a = new Attention();
    a.setTitle('s1', 'Fix login');
    a.onHost(host('running', { cwd: 'C:\\work\\app\\' }));
    expect(a.onHost(host('idle', { cwd: 'C:\\work\\app\\' }))).toMatchObject([{ kind: 'finished', body: 'Fix login · app' }]);
  });

  it('reports failures', () => {
    const a = new Attention();
    expect(a.onHost(host('error', { error: 'exited with code 1' }))).toMatchObject([{ kind: 'failed', body: 'exited with code 1' }]);
    expect(a.onHost(host('error'))).toEqual([]);
  });

  it('asks for attention on permission prompts and counts waiting sessions in the badge', () => {
    const a = new Attention();
    expect(a.onPermission(request('r1'))).toMatchObject([{ kind: 'needs-you', title: 'Claude wants to use Bash' }]);
    expect(a.onPermission(request('r2', 's1', 'AskUserQuestion'))[0]!.title).toBe('Claude has a question');
    a.onPermission(request('r3', 's2'));
    expect(a.badge()).toBe(2);
    a.onPermissionResolved('r1');
    a.onPermissionResolved('r2');
    expect(a.badge()).toBe(1);
  });

  it('notifies for terminal sessions waiting, but not for Claude desktop or IDE sessions', () => {
    const a = new Attention();
    expect(a.onLive([live('cli', 'needs-you'), live('desk', 'needs-you', 'desktop'), live('ide', 'needs-you', 'ide')])).toMatchObject([
      { kind: 'needs-you', sessionId: 'cli' },
    ]);
    expect(a.onLive([live('cli', 'needs-you')])).toEqual([]);
    expect(a.badge()).toBe(1);
    expect(a.onLive([live('cli', 'running')])).toEqual([]);
    expect(a.badge()).toBe(0);
  });

  it('leaves terminal sessions alone when only Switchboard sessions are shown', () => {
    let external = false;
    const a = new Attention({ external: () => external });
    expect(a.onLive([live('cli', 'needs-you')])).toEqual([]);
    expect(a.badge()).toBe(0);
    external = true;
    expect(a.onLive([live('cli', 'needs-you')])).toMatchObject([{ kind: 'needs-you', sessionId: 'cli' }]);
  });

  it('reports project actions that finish', () => {
    const a = new Attention();
    const term = (exitCode: number | null): TerminalInfo => ({ id: 't1', sessionId: 's1', kind: 'action', title: 'Publish', cwd: '/work/app', pid: 1, cols: 80, rows: 24, exitCode, startedAt: 0 });
    expect(a.onTerminals([term(null)])).toEqual([]);
    expect(a.onTerminals([term(1)])).toEqual([{ kind: 'action-done', sessionId: 's1', title: 'Publish failed (exit 1)', body: 'app' }]);
    expect(a.onTerminals([term(1)])).toEqual([]);
  });

  it('tells you a pipeline run stopped for you, and opens its parent', () => {
    const a = new Attention();
    expect(a.onPipelineNeedsYou({ runId: 'r1', parentId: 's1', title: 'Add dark mode', step: 'Validate', reason: 'Validate needs a decision' })).toEqual([
      { kind: 'pipeline-needs-you', sessionId: 's1', title: 'A pipeline needs you', body: 'Add dark mode: Validate needs a decision' },
    ]);
    // A run started from New session has a row of its own.
    expect(a.onPipelineNeedsYou({ runId: 'r2', parentId: 'run:r2', title: '', step: 'Push', reason: 'Ready to push' })[0]).toMatchObject({ sessionId: 'run:r2', body: 'Ready to push' });
  });
});
