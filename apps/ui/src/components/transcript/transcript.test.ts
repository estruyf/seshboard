import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@seshboard/protocol/client';
import { agentReport, buildDisplayItems, groupActivity, type DisplayItem } from './displayItems.ts';
import { activitySummary, gerund, stepLabel, toolSummary } from './toolSummary.ts';
import { agentForTask, agentModel, agentRuns, shownAgent, splitAgents, taskForAgent } from './agentRuns.ts';

const m = (uuid: string, role: TranscriptMessage['role'], blocks: TranscriptMessage['blocks'], parentToolUseId: string | null = null): TranscriptMessage => ({
  uuid,
  role,
  timestamp: null,
  parentToolUseId,
  model: null,
  blocks,
});

describe('buildDisplayItems', () => {
  it('pairs tool calls with their results and hides result-only user turns', () => {
    const items = buildDisplayItems([
      m('u1', 'user', [{ type: 'text', text: 'Run the tests' }]),
      m('a1', 'assistant', [
        { type: 'thinking', text: 'ok' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' }, truncated: false },
      ]),
      m('u2', 'user', [{ type: 'tool_result', toolUseId: 't1', isError: false, text: '5 passed', truncated: false, images: [] }]),
      m('a2', 'assistant', [{ type: 'text', text: 'All green.' }]),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'thinking', 'tool', 'text']);
    expect(items[2]).toMatchObject({ kind: 'tool', name: 'Bash', result: { text: '5 passed', isError: false } });
  });

  it('recognises slash commands, command output, interrupts and strips system reminders', () => {
    const items = buildDisplayItems([
      m('u1', 'user', [{ type: 'text', text: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>--fast</command-args>' }]),
      m('u2', 'user', [{ type: 'text', text: '<local-command-stdout>Compacted</local-command-stdout>' }]),
      m('u3', 'user', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      m('u4', 'user', [{ type: 'text', text: '<system-reminder>hidden</system-reminder>' }]),
      m('u5', 'user', [{ type: 'text', text: 'Real prompt<system-reminder>x</system-reminder>' }]),
    ]);
    expect(items).toMatchObject([
      { kind: 'command', key: 'u1', name: '/review', args: '--fast' },
      { kind: 'notice', key: 'u2', text: 'Compacted' },
      { kind: 'notice', key: 'u3', text: 'Interrupted by you' },
      { kind: 'user', key: 'u5', text: 'Real prompt', images: [], subagent: false },
    ]);
  });

  it('marks subagent output and labels system events', () => {
    const items = buildDisplayItems([
      m('a1', 'assistant', [{ type: 'text', text: 'from a subagent' }], 'task-1'),
      m('s1', 'system', [{ type: 'unknown', kind: 'compact_boundary' }]),
    ]);
    expect(items).toMatchObject([{ kind: 'text', subagent: true }, { kind: 'notice', text: 'Conversation compacted' }]);
  });
});

describe('toolSummary', () => {
  it('summarises common tools', () => {
    expect(toolSummary('Read', { file_path: '/repo/src/a.ts' }, '/repo')).toEqual({ label: 'Read', detail: 'src/a.ts' });
    expect(toolSummary('Bash', { command: 'npm test', description: 'Run tests' }, null)).toEqual({ label: 'Bash', detail: 'Run tests' });
    expect(toolSummary('TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }, null)).toEqual({ label: 'Todos', detail: '1/2 done' });
    expect(toolSummary('mcp__claude_ai_Notion__notion-search', { query: 'roadmap' }, null)).toEqual({ label: 'Notion · notion-search', detail: 'roadmap' });
  });
});

const tool = (key: string, name: string, input: Record<string, unknown> = {}): DisplayItem => ({
  kind: 'tool', key, at: null, id: key, name, input, inputTruncated: false, result: null, subagent: false,
});
const text = (key: string, value: string): DisplayItem => ({ kind: 'text', key, at: null, text: value, subagent: false });

describe('groupActivity', () => {
  it('collapses runs of tool calls between messages and keeps plans visible', () => {
    const grouped = groupActivity([
      text('t1', 'Let me look.'),
      tool('a', 'Read', { file_path: '/r/a.ts' }),
      { kind: 'thinking', key: 'th', at: null, text: 'hmm' },
      tool('b', 'Bash', { command: 'ls' }),
      text('t2', 'Found it.'),
      tool('c', 'ExitPlanMode', { plan: 'Do it' }),
      tool('d', 'Edit', { file_path: '/r/a.ts' }),
    ]);
    expect(grouped.map((g) => (g.kind === 'activity' ? `group(${g.items.map((i) => i.key).join(',')})` : g.key))).toEqual(['t1', 'group(a,th,b)', 't2', 'c', 'group(d)']);
    expect(grouped[1]!.key).toBe('activity:a');
  });
});

describe('activitySummary', () => {
  it('counts what a run did, files once each', () => {
    expect(
      activitySummary([
        tool('1', 'Bash'),
        tool('2', 'Bash'),
        tool('3', 'Edit', { file_path: '/a' }),
        tool('4', 'Edit', { file_path: '/a' }),
        tool('5', 'Read', { file_path: '/b' }),
      ]),
    ).toBe('Ran 2 commands, edited a file and read a file');
    expect(activitySummary([tool('1', 'mcp__claude_ai_Notion__notion-search')])).toBe('Used Notion');
    expect(activitySummary([{ kind: 'thinking' }])).toBe('Thought it through');
  });
});

describe('stepLabel', () => {
  it('words steps like Claude Code, in the past for the list and the present while running', () => {
    expect(stepLabel(tool('1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }), null)).toEqual({ past: 'Run the unit tests', present: 'Running the unit tests' });
    expect(stepLabel(tool('1', 'Read', { file_path: '/repo/src/a.ts' }), '/repo')).toEqual({ past: 'Read src/a.ts', present: 'Reading src/a.ts' });
    expect(stepLabel(tool('1', 'Grep', { pattern: 'TODO' }), null).present).toBe('Searching for TODO');
    // Not every description starts with a verb.
    expect(stepLabel(tool('1', 'Bash', { description: 'Only stop when scrolling up' }), null).present).toBe('Only stop when scrolling up');
    expect(stepLabel(tool('1', 'Bash', { description: 'Rerun the smoke test' }), null).present).toBe('Rerunning the smoke test');
    expect(stepLabel(tool('1', 'Bash', { description: 'Read the file' }), null).present).toBe('Reading the file');
  });

  it('names a command without a description by what it runs, not its script', () => {
    const run = (command: string) => stepLabel(tool('1', 'Bash', { command }), null);
    expect(run('npm test')).toEqual({ past: 'Run npm test', present: 'Running npm test' });
    expect(run('cd "/repo/my app" && npm test').present).toBe('Running npm test');
    expect(run("python3 -I - <<'E'\nimport re\nR=re.compile(r'<<<<<<< HEAD')\nE").present).toBe('Running a Python script');
    expect(run('/usr/bin/python3.12 -c "import sys; print(sys.version); print(sys.path); print(sys.executable)"').present).toBe('Running a Python script');
    expect(run("cat > /tmp/a.txt <<'EOF'\nhello\nEOF").present).toBe('Running cat');
    expect(run('FORCE_COLOR=0 git log --oneline --decorate --graph --all --since="2 weeks ago" -- apps/ui').present).toBe('Running git');
    expect(run("node -e 'console.log(1)'\necho done").present).toBe('Running a Node script');
    expect(run('$(which x) --a-very-long-flag-to-push-this-over-the-limit --and-another-one').present).toBe('Running a command');
  });

  it('turns verbs into -ing forms', () => {
    expect(['Read', 'Run', 'Use', 'Write', 'Fix', 'Stop', 'Open', 'Tie', 'Check', 'commit', 'Let', 'Add', 'Show', 'Plan', 'Edit', 'Visit', 'Quit', 'Rerun'].map(gerund)).toEqual([
      'Reading', 'Running', 'Using', 'Writing', 'Fixing', 'Stopping', 'Opening', 'Tying', 'Checking', 'committing', 'Letting', 'Adding', 'Showing', 'Planning', 'Editing', 'Visiting', 'Quitting', 'Rerunning',
    ]);
  });
});

describe('agent reports', () => {
  const handBack =
    'Another Claude session sent a message:\n<agent-message from="ac19e09f62c5886f3">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Found **3 files**.\n  \n  - a.txt\n</agent-message>\n\nGuidance for the session.';

  it('reads the agent id and the report, without the indent', () => {
    expect(agentReport(handBack)).toEqual({ agentId: 'ac19e09f62c5886f3', toolUseId: null, status: 'completed', title: 'Found **3 files**.', text: 'Found **3 files**.\n\n- a.txt' });
    // The live stream sends the tag without the line before it.
    const live = handBack.slice('Another Claude session sent a message:\n'.length);
    expect(agentReport(live)).toEqual(agentReport(handBack));
    expect(agentReport('Can you explain <agent-message from="x">hi</agent-message>?')).toBeNull();
    const notification =
      '<task-notification>\n<task-id>aa50</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Agent "List files" finished</summary>\n<result>79 files</result>\n</task-notification>';
    expect(agentReport(notification)).toEqual({ agentId: 'aa50', toolUseId: 'toolu_1', status: 'completed', title: 'Agent "List files" finished', text: '79 files' });
  });

  it('turns a hand-back into a report item that groups with the other steps', () => {
    const items = buildDisplayItems([m('u1', 'user', [{ type: 'text', text: handBack }])]);
    expect(items).toMatchObject([{ kind: 'agent-report', agentId: 'ac19e09f62c5886f3' }]);
    expect(groupActivity(items)[0]!.kind).toBe('activity');
    expect(activitySummary(items)).toBe('An agent reported back');
  });
});

describe('agentRuns', () => {
  const agent = (key: string, result: string | null): DisplayItem => ({
    ...tool(key, 'Agent', { description: key }),
    result: result === null ? null : { text: result, isError: false, truncated: false, images: [], at: null },
  } as DisplayItem);
  const launched = (id: string) => `Async agent launched successfully.\nagentId: ${id} (internal ID)\nThe agent is working in the background.`;

  it('runs foreground agents until they return and background ones until they report back', () => {
    const items = [
      agent('fg-done', 'Found 3 files'),
      agent('fg-running', null),
      agent('bg-running', launched('abc123')),
      agent('bg-done', launched('def456')),
      { kind: 'agent-report', key: 'r', at: null, agentId: 'def456', toolUseId: null, status: 'completed', title: 'Done', text: 'Done' } as DisplayItem,
    ];
    expect(agentRuns(items, true).map((r) => [r.item.key, r.running, r.background])).toEqual([
      ['fg-done', false, false],
      ['fg-running', true, false],
      ['bg-running', true, true],
      ['bg-done', false, true],
    ]);
    // Nothing runs in a session that isn't open.
    expect(agentRuns(items, false).some((r) => r.running)).toBe(false);
  });

  it('runs a background agent again when a message to it follows its last report (resumed after the usage limit)', () => {
    const report = (key: string, status: string, text: string) => ({ kind: 'agent-report', key, at: null, agentId: 'abc123', toolUseId: null, status, title: text, text }) as DisplayItem;
    const send = (key: string, to: string, isError = false) =>
      ({ ...tool(key, 'SendMessage', { to, message: 'Carry on' }), result: { text: '{"success":true}', isError, truncated: false, images: [], at: null } }) as DisplayItem;
    const bg = agent('bg', launched('abc123'));
    const stopped = report('r1', 'failed', 'Agent terminated early: You\'ve hit your session limit');
    const state = (items: DisplayItem[]) => agentRuns(items, true)[0]!;

    expect(state([bg, stopped])).toMatchObject({ running: false, failed: true });
    expect(state([bg, report('r0', 'killed', 'Stopped')]).failed).toBe(true);
    expect(state([bg, report('r0', 'completed', 'Done')]).failed).toBe(false);
    expect(state([bg]).failed).toBe(false);
    // The user (or Claude) sends it on again: it runs until its next report.
    expect(state([bg, stopped, send('s1', 'abc123')])).toMatchObject({ running: true, failed: false });
    const second = report('r2', 'completed', 'Done after the resume');
    expect(state([bg, stopped, send('s1', 'abc123'), second])).toMatchObject({ running: false, failed: false, report: 'Done after the resume' });
    expect(state([bg, stopped, send('s1', 'abc123'), second, send('s2', 'abc123')]).running).toBe(true);
    // A message before the report, to another agent, or one that failed, changes nothing.
    expect(state([bg, send('s0', 'abc123'), stopped]).running).toBe(false);
    expect(state([bg, stopped, send('s1', 'other')]).running).toBe(false);
    expect(state([bg, stopped, send('s1', 'abc123', true)]).running).toBe(false);
    expect(agentRuns([bg, stopped, send('s1', 'abc123')], false)[0]!.running).toBe(false);
  });

  it('marks a foreground agent whose call returned an error as failed', () => {
    const errored = { ...agent('fg', 'API Error'), result: { text: 'API Error', isError: true, truncated: false, images: [], at: null } } as DisplayItem;
    expect(agentRuns([errored], true)[0]).toMatchObject({ running: false, failed: true });
    expect(agentRuns([agent('ok', 'Found 3 files')], true)[0]!.failed).toBe(false);
  });

  it('keeps what each agent was asked, its type and what it reported', () => {
    const asked = {
      ...tool('a', 'Agent', { description: 'Find the tests', subagent_type: 'Explore', prompt: 'Look for every test file.' }),
      result: { text: 'Found 3 files', isError: false, truncated: false, images: [], at: null },
    } as DisplayItem;
    const bg = { ...tool('b', 'Agent', { description: 'Review it' }), result: { text: launched('abc123'), isError: false, truncated: false, images: [], at: null } } as DisplayItem;
    const hand = { kind: 'agent-report', key: 'r', at: null, agentId: 'abc123', toolUseId: null, status: 'completed', title: 'Done', text: 'Looks fine.' } as DisplayItem;
    const [first, second] = agentRuns([asked, bg, hand], true);
    expect(first).toMatchObject({ type: 'Explore', what: 'Find the tests', prompt: 'Look for every test file.', report: 'Found 3 files', agentId: null });
    // A background agent's own report is the hand-back, not the launch message.
    expect(second).toMatchObject({ background: true, agentId: 'abc123', report: 'Looks fine.', prompt: null, type: null });
  });

  it('names the model an agent runs on: the one its replies used, else the one the call asked for', () => {
    const [withModel, without] = agentRuns([agent('a', null), agent('b', null)].map((item, i) => (i === 0 ? ({ ...item, input: { description: 'a', model: 'haiku' } } as DisplayItem) : item)), true);
    expect(withModel!.asked).toBe('haiku');
    expect(without!.asked).toBeNull();
    const used = { model: 'claude-opus-5-5', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 1 };
    expect(agentModel(withModel!, used)).toBe('claude-opus-5-5');
    expect(agentModel(withModel!, undefined)).toBe('haiku');
    expect(agentModel(without!, undefined)).toBeNull();
    // Replies that used more than one model name none.
    expect(agentModel(without!, { ...used, model: null })).toBeNull();
  });
});

describe('agents and the background tasks', () => {
  const run = (key: string, over: Partial<ReturnType<typeof agentRuns>[number]>) => ({ item: tool(key, 'Agent', {}), running: true, background: true, agentId: null, type: null, what: key, prompt: null, asked: null, report: null, ...over }) as ReturnType<typeof agentRuns>[number];
  const task = (taskId: string, description: string) => ({ taskId, type: 'local_agent', description, startedAt: 0 });

  it('finds the agent a task stands for by its id, else by a description only one running agent has', () => {
    const runs = [run('a', { agentId: 'abc123', what: 'Review' }), run('b', { what: 'Lint' }), run('c', { what: 'Lint' })];
    expect(agentForTask(task('abc123', 'something else'), runs)?.item.key).toBe('a');
    expect(agentForTask(task('zzz', 'Review'), runs)?.item.key).toBe('a');
    // Two agents with the same words: no guess.
    expect(agentForTask(task('zzz', 'Lint'), runs)).toBeUndefined();
    expect(agentForTask(task('zzz', 'Unknown'), runs)).toBeUndefined();
  });

  it('only a running background agent has a task to stop', () => {
    const a = run('a', { agentId: 'abc123' });
    expect(taskForAgent(a, [task('abc123', 'x')])?.taskId).toBe('abc123');
    expect(taskForAgent(run('a', { agentId: 'abc123', running: false }), [task('abc123', 'x')])).toBeUndefined();
    expect(taskForAgent(run('a', { agentId: 'abc123', background: false }), [task('abc123', 'x')])).toBeUndefined();
  });

  it('splits running from finished and shows the one picked, else the newest running, else the newest', () => {
    const runs = [run('new', { running: false }), run('busy', {}), run('old', { running: false })];
    const { active, finished } = splitAgents(runs);
    expect(active.map((r) => r.item.key)).toEqual(['busy']);
    expect(finished.map((r) => r.item.key)).toEqual(['new', 'old']);
    expect(shownAgent(runs, runs[2]!.item.id)?.item.key).toBe('old');
    expect(shownAgent(runs, null)?.item.key).toBe('busy');
    expect(shownAgent(runs, 'gone')?.item.key).toBe('busy');
    expect(shownAgent([run('x', { running: false }), run('y', { running: false })], null)?.item.key).toBe('x');
    expect(shownAgent([], null)).toBeUndefined();
  });
});
