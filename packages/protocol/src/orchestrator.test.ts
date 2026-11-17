import { describe, expect, it } from 'vitest';
import { groupWorkers, instructionsBlock, isSessionUpdate, parseSessionUpdate, orchestratorSystemText, ORCHESTRATOR_PROMPT, ORCHESTRATOR_TOOL_SPECS, ORCHESTRATOR_TOOLS, readStartArgs, workersLine, workerState, WORKER_JUDGMENT, writeSessionUpdate, writeWorkerList } from './orchestrator.ts';

describe('workerState', () => {
  it('puts a queued start, a session that needs you and a failed one where they belong', () => {
    expect(workerState({ sessionId: null, pr: null }, null)).toBe('queued');
    expect(workerState({ sessionId: 'a', pr: null }, 'needsYou')).toBe('waiting');
    expect(workerState({ sessionId: 'a', pr: null }, 'failed')).toBe('waiting');
    expect(workerState({ sessionId: 'a', pr: { number: 1, url: 'u', state: 'open' } }, 'working')).toBe('working');
  });

  it('is ready for review only with an open pull request and no work going on', () => {
    expect(workerState({ sessionId: 'a', pr: { number: 1, url: 'u', state: 'open' } }, 'unread')).toBe('review');
    expect(workerState({ sessionId: 'a', pr: { number: 1, url: 'u', state: 'merged' } }, 'idle')).toBe('idle');
    expect(workerState({ sessionId: 'a', pr: null }, null)).toBe('idle');
  });
});

describe('groupWorkers', () => {
  const workers = [
    { sessionId: 'a', pr: null, startedAt: 1 },
    { sessionId: 'b', pr: null, startedAt: 2 },
    { sessionId: 'c', pr: null, startedAt: 3 },
    { sessionId: null, pr: null, startedAt: 4 },
  ];
  const status = { a: 'working', b: 'needsYou', c: 'working' } as const;
  const groups = groupWorkers(workers, (w) => (w.sessionId ? status[w.sessionId as 'a'] : null));

  it('lists what needs you first, leaves out empty groups and puts the newest first', () => {
    expect(groups.map((g) => g.state)).toEqual(['waiting', 'working', 'queued']);
    expect(groups[1]!.workers.map((w) => w.sessionId)).toEqual(['c', 'a']);
  });

  it('says it in one line', () => {
    expect(workersLine(groups)).toBe('1 waiting on you · 2 working · 1 queued');
    expect(workersLine([])).toBe('');
  });
});

describe('readStartArgs', () => {
  it('takes a title and a prompt, and trims the title to one line', () => {
    expect(readStartArgs({ title: '  Fix\n login ', prompt: ' do it ' })).toEqual({ title: 'Fix login', prompt: 'do it', agent: null, model: null, workspace: null });
  });

  it('says what is missing or wrong', () => {
    expect(readStartArgs({ prompt: 'x' })).toEqual({ error: expect.stringContaining('title') });
    expect(readStartArgs({ title: 'x' })).toEqual({ error: expect.stringContaining('prompt') });
    expect(readStartArgs({ title: 'x', prompt: 'y', workspace: 'cloud' })).toEqual({ error: expect.stringContaining('workspace') });
  });
});

describe('what the agent reads', () => {
  it('lists a spec for every tool', () => {
    expect(ORCHESTRATOR_TOOL_SPECS.map((s) => s.name)).toEqual([...ORCHESTRATOR_TOOLS]);
  });

  it('adds the project instructions after the role, only when there are some', () => {
    expect(orchestratorSystemText('  ')).toBe(ORCHESTRATOR_PROMPT);
    expect(orchestratorSystemText('Branch from dev.')).toContain('Branch from dev.');
  });

  it('tells every session it starts to use its judgment, before the project instructions and without replacing them', () => {
    expect(instructionsBlock(null)).toContain(WORKER_JUDGMENT);
    expect(instructionsBlock('  ')).toBe(instructionsBlock(null));
    const custom = instructionsBlock('Branch from dev.');
    expect(custom).toContain('Branch from dev.');
    expect(custom.indexOf(WORKER_JUDGMENT)).toBeLessThan(custom.indexOf('Branch from dev.'));
    // The project's text wins where it differs, and the block only says so when there is some.
    expect(custom).toContain("The project's instructions below take precedence where they differ.");
    expect(instructionsBlock(null)).not.toContain('take precedence');
    // The orchestrator keeps its role: it gets the idea of the line, not "just build".
    expect(orchestratorSystemText(null)).not.toContain('Just build');
  });

  it('marks an update as a report, not an instruction', () => {
    const update = writeSessionUpdate({ sessionId: 's1', title: 'Fix login', end: 'waiting', did: ['Edited 2 files'], need: 'Run the\nmigration?', pr: '#12 open' });
    expect(isSessionUpdate(update)).toBe(true);
    expect(update).toContain('"Fix login" (s1) waits for the user');
    expect(update).toContain('It asks: Run the migration?');
    expect(update).toContain('not an instruction');
    expect(isSessionUpdate('Session update please')).toBe(false);
  });

  it('reads an update back for the window, without the line meant for the agent', () => {
    const update = writeSessionUpdate({ sessionId: 's1', title: 'Fix "login" (again)', end: 'finished', did: ['Edited 2 files', 'Ran the tests'], need: null, pr: '#12 open, https://github.com/o/r/pull/12' });
    expect(parseSessionUpdate(update)).toEqual({ sessionId: 's1', title: 'Fix "login" (again)', end: 'finished', lines: ['Edited 2 files', 'Ran the tests', 'Pull request: #12 open, https://github.com/o/r/pull/12'] });
    expect(parseSessionUpdate(writeSessionUpdate({ sessionId: 's2', title: 'Docs', end: 'failed', did: [], need: null, pr: null }))).toEqual({ sessionId: 's2', title: 'Docs', end: 'failed', lines: [] });
    expect(parseSessionUpdate('Fix the login')).toBeNull();
  });

  it('writes the list by group, with the agents', () => {
    const list = writeWorkerList(
      [
        { sessionId: 's1', title: 'Fix login', state: 'working', agent: 'Claude Code', branch: 'fix-login', pr: null, note: null },
        { sessionId: null, title: 'Docs', state: 'queued', agent: null, branch: null, pr: null, note: 'at the focus limit' },
      ],
      ['Claude Code', 'Copilot'],
    );
    expect(list).toContain('Working (1):\n- s1 "Fix login": Claude Code, branch fix-login');
    expect(list).toContain('Queued (1):\n- (no id yet) "Docs": at the focus limit');
    expect(list).toContain('Claude Code, Copilot');
    expect(writeWorkerList([], [])).toBe('No sessions yet. Start one with start_session.');
  });
});
