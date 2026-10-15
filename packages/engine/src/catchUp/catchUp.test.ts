import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { asksBack, fallbackSummary, needKind, testsText, waitingNeed } from './fallback.ts';
import { inScope, namedPaths, scopeCheck, signalsOf, testsSignal, type Signals } from './signals.ts';
import { parseSummary, parseWhy, stubSummary, summaryInput, whyInput } from './summary.ts';
import { isTestCommand, parseTestCounts } from './testCommands.ts';
import { askOf, lastTurn, mergeMessages, promptText, type ToolCall, type Turn } from './turn.ts';

const user = (uuid: string, content: unknown): RawSessionMessage => ({ type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content } });
const assistant = (uuid: string, content: unknown[]): RawSessionMessage => ({ type: 'assistant', uuid, parent_tool_use_id: null, message: { role: 'assistant', content } });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, content: string, isError = false) => user(`r-${id}`, [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]);

const call = (patch: Partial<ToolCall>): ToolCall => ({ id: 't', name: 'Bash', file: null, command: null, exitCode: 0, declined: false, output: '', ...patch });
const turnOf = (patch: Partial<Turn>): Turn => ({ id: 'turn', ask: 'Fix the sidebar', finalText: 'Done.', tools: [], plan: null, ...patch });
const signals = (patch: Partial<Signals> = {}): Signals => ({ tests: { state: 'notRun' }, diff: null, outOfScope: [], scope: null, plan: null, ...patch });

const VITEST_PASS = `
 ✓ src/a.test.ts (6 tests) 12ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  10:00:00
`;
const VITEST_FAIL = `\u001b[31m FAIL \u001b[39m src/a.test.ts > sorts
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 7 passed (9)
`;
const JEST_FAIL = `
Test Suites: 1 failed, 2 passed, 3 total
Tests:       2 failed, 7 passed, 9 total
Snapshots:   0 total
`;
const PYTEST_FAIL = `
FAILED tests/test_sort.py::test_order - AssertionError
========================= 1 failed, 12 passed in 0.42s =========================
`;
const PYTEST_PASS = '============================== 5 passed, 1 warning in 0.10s ==============================\n';

describe('test commands', () => {
  it.each([
    ['npm test', true],
    ['pnpm test', true],
    ['yarn test --watch=false', true],
    ['bun test', true],
    ['npm run test:unit', true],
    ['npm run check', true],
    ['npx vitest run src/state', true],
    ['cd apps/ui && npx vitest run', true],
    ['CI=1 npm test', true],
    ['jest --coverage', true],
    ['python -m pytest -q', true],
    ['uv run pytest tests/', true],
    ['go test ./...', true],
    ['cargo test', true],
    ['dotnet test', true],
    ['mvn -q test', true],
    ['./gradlew test', true],
    ['swift test', true],
    ['xcodebuild -scheme App test', true],
    ['npm run build', false],
    ['npm install', false],
    ['git commit -m "test"', false],
    ['echo test', false],
    ['cat test.log | grep vitest', false],
  ])('%s → %s', (command, expected) => {
    expect(isTestCommand(command)).toBe(expected);
  });

  it('reads vitest, jest and pytest counts, and nothing from other output', () => {
    expect(parseTestCounts(VITEST_PASS)).toEqual({ passed: 14, failed: 0 });
    expect(parseTestCounts(VITEST_FAIL)).toEqual({ passed: 7, failed: 2 });
    expect(parseTestCounts(JEST_FAIL)).toEqual({ passed: 7, failed: 2 });
    expect(parseTestCounts(PYTEST_FAIL)).toEqual({ passed: 12, failed: 1 });
    expect(parseTestCounts(PYTEST_PASS)).toEqual({ passed: 5, failed: 0 });
    expect(parseTestCounts('test result: FAILED. 7 passed; 2 failed; 0 ignored')).toEqual({ passed: 7, failed: 2 });
    expect(parseTestCounts('ok  \tgithub.com/x/y\t0.2s')).toBeNull();
    expect(parseTestCounts('Compiled successfully')).toBeNull();
  });

  it('uses the last test run of the turn, with its exit code and counts', () => {
    const tools = [
      call({ command: 'npm test', exitCode: 1, output: VITEST_FAIL }),
      call({ command: 'npm run build', exitCode: 0 }),
      call({ command: 'npx vitest run', exitCode: 0, output: VITEST_PASS }),
    ];
    expect(testsSignal(tools)).toEqual({ state: 'passed', passed: 14, failed: 0, command: 'npx vitest run' });
    expect(testsSignal(tools.slice(0, 2))).toEqual({ state: 'failed', passed: 7, failed: 2, command: 'npm test' });
    expect(testsSignal([call({ command: 'go test ./...', exitCode: 2, output: 'FAIL' })])).toEqual({ state: 'failed', command: 'go test ./...' });
    expect(testsSignal([call({ command: 'npm run build' })])).toEqual({ state: 'notRun' });
    // A test run you declined never ran.
    expect(testsSignal([call({ command: 'npm test', exitCode: 1, declined: true })])).toEqual({ state: 'notRun' });
  });
});

describe('scope', () => {
  const root = '/repo';
  const edit = (file: string) => call({ name: 'Edit', file, exitCode: 0 });

  it('finds the files and folders a text names', () => {
    expect(namedPaths('Change `apps/ui/src/state/sidebarRows.ts` and the Sidebar.tsx row, see https://x.dev/a/b and v1.2.3.', root)).toEqual([
      'apps/ui/src/state/sidebarRows.ts',
      'Sidebar.tsx',
    ]);
    expect(namedPaths('Everything stays in apps/ui/.', root)).toEqual(['apps/ui']);
    expect(namedPaths('Look at /repo/packages/engine and /etc/hosts', root)).toEqual(['packages/engine']);
  });

  it('leaves out prose with a slash unless its first folder is in the checkout', () => {
    const exists = (path: string) => ['apps', 'src'].includes(path);
    expect(namedPaths('Do some chaos/monkey testing in apps/ui, and/or src/state, and add notes/todo.md', root, exists)).toEqual(['apps/ui', 'src/state', 'notes/todo.md']);
  });

  it('covers a file inside a scope folder, the file itself, and a bare file name anywhere', () => {
    expect(inScope('apps/ui/src/a.ts', ['apps/ui'])).toBe(true);
    expect(inScope('apps/uikit/a.ts', ['apps/ui'])).toBe(false);
    expect(inScope('apps/ui/src/state/sidebarRows.ts', ['sidebarRows.ts'])).toBe(true);
    expect(inScope('packages/engine/x.ts', ['apps/ui', 'README.md'])).toBe(false);
  });

  it('with a plan, checks the files against the plan', () => {
    const turn = turnOf({ plan: 'Only touch apps/ui.', ask: 'Do packages/engine too', tools: [edit('/repo/apps/ui/a.ts'), edit('/repo/packages/engine/b.ts'), edit('/repo/packages/protocol/c.ts')] });
    expect(scopeCheck(turn, root)).toEqual({ outOfScope: ['packages/engine/b.ts', 'packages/protocol/c.ts'], label: 'apps/ui' });
  });

  it('without a plan, checks the files against the paths the ask names', () => {
    const turn = turnOf({ ask: 'Fix apps/ui/src/state and README.md', tools: [edit('/repo/apps/ui/src/state/x.ts'), edit('/repo/README.md'), edit('/repo/package.json')] });
    expect(scopeCheck(turn, root)).toEqual({ outOfScope: ['package.json'], label: null });
  });

  it('without any scope nothing is out of scope, except a file outside the checkout, which always is', () => {
    expect(scopeCheck(turnOf({ ask: 'Make it faster', tools: [edit('/repo/a.ts')] }), root).outOfScope).toEqual([]);
    expect(scopeCheck(turnOf({ ask: 'Make it faster', tools: [edit('/repo/a.ts'), edit('/Users/you/.zshrc')] }), root).outOfScope).toEqual(['/Users/you/.zshrc']);
    expect(scopeCheck(turnOf({ plan: 'Edit apps/ui', tools: [edit('/elsewhere/apps/ui/a.ts')] }), root).outOfScope).toEqual(['/elsewhere/apps/ui/a.ts']);
  });

  it('says whether the plan was followed, and only when there was one', () => {
    const tools = [edit('/repo/apps/ui/a.ts')];
    expect(signalsOf(turnOf({ tools }), null, root).plan).toBeNull();
    expect(signalsOf(turnOf({ tools, plan: 'Edit apps/ui' }), null, root).plan).toBe('followed');
    expect(signalsOf(turnOf({ tools, plan: 'Edit apps/ui' }), null, root, true).plan).toBe('deviated');
    expect(signalsOf(turnOf({ tools: [edit('/repo/b.ts')], plan: 'Edit apps/ui' }), null, root).plan).toBe('deviated');
  });
});

describe('the turn', () => {
  it('tells your prompts from what Claude Code writes into user turns', () => {
    expect(promptText(user('1', 'Fix it'))).toBe('Fix it');
    expect(promptText(user('2', [{ type: 'text', text: '<command-message>review</command-message><command-name>/review</command-name><command-args>all</command-args>' }]))).toBe('/review all');
    expect(promptText(toolResult('x', 'ok'))).toBeNull();
    expect(promptText(user('3', '[Request interrupted by user]'))).toBeNull();
    expect(promptText(user('4', '<task-notification><task-id>t</task-id></task-notification>'))).toBeNull();
    expect(promptText({ ...user('5', 'sub'), parent_tool_use_id: 'task' })).toBeNull();
  });

  it('takes the prompt before a short reply as the ask', () => {
    expect(askOf(['Add a Needs review sort to the sidebar', 'yes, go ahead'])).toBe('Add a Needs review sort to the sidebar');
    expect(askOf(['Old work', 'Now rename the settings page to Preferences'])).toBe('Now rename the settings page to Preferences');
    expect(askOf(['x '.repeat(200)]).length).toBeLessThanOrEqual(240);
  });

  it('reads the last turn: its tool calls with exit codes, the last reply, and the session’s plan', () => {
    const messages = [
      user('p0', 'Plan the sort'),
      assistant('a0', [toolUse('plan', 'ExitPlanMode', { plan: 'Change apps/ui only' })]),
      toolResult('plan', 'approved'),
      user('p1', 'Add the sort to apps/ui'),
      assistant('a1', [toolUse('e1', 'Edit', { file_path: '/repo/apps/ui/a.ts', old_string: 'x', new_string: 'SECRET' }), toolUse('b1', 'Bash', { command: 'npm test' })]),
      toolResult('e1', 'ok'),
      toolResult('b1', `Exit code 1\n${VITEST_FAIL}`, true),
      assistant('a2', [toolUse('b2', 'Bash', { command: 'rm -rf dist' })]),
      toolResult('b2', "The user doesn't want to proceed with this tool use.", true),
      assistant('a3', [{ type: 'text', text: 'Two tests fail. Should I fix them?' }]),
    ];
    const turn = lastTurn(messages)!;
    expect(turn.id).toBe('a3');
    expect(turn.ask).toBe('Add the sort to apps/ui');
    expect(turn.plan).toBe('Change apps/ui only');
    expect(turn.finalText).toBe('Two tests fail. Should I fix them?');
    expect(turn.tools.map((t) => [t.name, t.file ?? t.command, t.exitCode, t.declined])).toEqual([
      ['Edit', '/repo/apps/ui/a.ts', 0, false],
      ['Bash', 'npm test', 1, false],
      ['Bash', 'rm -rf dist', 1, true],
    ]);
    // A prompt Claude hasn't answered yet has no turn.
    expect(lastTurn([...messages, user('p2', 'And the banner too')])).toBeNull();
  });

  it('merges live messages the file doesn’t have yet, without subagents', () => {
    const file = [user('p', 'Go'), assistant('a', [{ type: 'text', text: 'one' }])];
    const live = [assistant('a', [{ type: 'text', text: 'one' }]), assistant('b', [{ type: 'text', text: 'two' }]), { ...assistant('s', []), parent_tool_use_id: 'task' }];
    expect(mergeMessages(file, live).map((m) => m.uuid)).toEqual(['p', 'a', 'b']);
  });
});

describe('the fallback summary', () => {
  it('says what was edited and run, and what failed or you declined', () => {
    const turn = turnOf({
      tools: [
        call({ name: 'Edit', file: '/repo/a.ts' }),
        call({ name: 'Write', file: '/repo/b.ts' }),
        call({ name: 'Read', file: '/repo/c.ts' }),
        call({ command: 'git status' }),
        call({ command: 'npm run lint', exitCode: 2 }),
        call({ command: 'npm run check', exitCode: 0, output: VITEST_PASS }),
        call({ command: 'rm -rf dist', exitCode: 1, declined: true }),
      ],
    });
    const summary = fallbackSummary(turn, signals({ tests: { state: 'passed', passed: 14, failed: 0 }, diff: { files: 2, add: 10, del: 2 } }), { state: 'finished', error: null });
    expect(summary.did).toEqual(['Edited 2 files', 'Ran npm run lint', 'Ran npm run check', 'Read 1 file']);
    expect(summary.skipped).toEqual(['npm run lint failed (exit 2)', 'You declined rm -rf dist']);
    expect(summary.need).toEqual({ kind: 'commit', title: 'Commit the changes', text: 'Tests pass. Ready to commit.' });
  });

  it('says it looked around when that is all it did, and leaves a failed look-around out of skipped', () => {
    const turn = turnOf({ tools: [call({ command: 'ls && cat package.json; ls tests', exitCode: 2 }), call({ command: 'git status' })] });
    const summary = fallbackSummary(turn, signals(), { state: 'finished', error: null });
    expect(summary.did).toEqual(['Looked through the project']);
    expect(summary.skipped).toEqual([]);
  });

  it('follows the rules for what it needs from you', () => {
    const clean = signals({ diff: { files: 1, add: 1, del: 0 } });
    expect(needKind({ state: 'finished', signals: clean, asksBack: false })).toBe('commit');
    expect(needKind({ state: 'finished', signals: signals(), asksBack: false })).toBe('none');
    expect(needKind({ state: 'finished', signals: signals({ diff: clean.diff, tests: { state: 'failed' } }), asksBack: false })).toBe('reply');
    expect(needKind({ state: 'finished', signals: clean, asksBack: true })).toBe('reply');
    expect(needKind({ state: 'error', signals: clean, asksBack: false })).toBe('reply');
    expect(needKind({ state: 'finished', signals: signals({ diff: clean.diff, outOfScope: ['x.ts'] }), asksBack: false })).toBe('review');
    // Outside git there is no Changes panel to review in.
    expect(needKind({ state: 'finished', signals: signals({ diff: null, outOfScope: ['/elsewhere/x.ts'] }), asksBack: false })).toBe('none');
    expect(fallbackSummary(turnOf({ finalText: 'Done.\n\nShould I also update the docs?' }), signals(), { state: 'finished', error: null }).need).toEqual({
      kind: 'reply',
      title: 'Answer Claude’s question',
      text: 'Should I also update the docs?',
    });
    expect(fallbackSummary(turnOf({}), signals({ outOfScope: ['a.ts', 'b.ts'], scope: 'apps/ui', diff: clean.diff }), { state: 'finished', error: null }).need.text).toBe(
      '2 files outside apps/ui. Look at them before you commit.',
    );
  });

  it('reads a question at the end of a reply, not one earlier on', () => {
    expect(asksBack('Is this right? I fixed it.')).toBeNull();
    expect(asksBack('I fixed it.\n\n```js\nwhy?\n```')).toBeNull();
    expect(asksBack('I fixed it. **Want me to add tests?**')).toBe('Want me to add tests?');
  });

  it('words the tests as the chip does', () => {
    expect(testsText({ state: 'passed', passed: 14, failed: 0 })).toBe('14 tests passed');
    expect(testsText({ state: 'failed', passed: 7, failed: 2 })).toBe('2 of 9 tests fail');
    expect(testsText({ state: 'failed' })).toBe('Tests failed');
    expect(testsText({ state: 'notRun' })).toBe('No tests run');
  });

  it('takes a waiting card’s next step from the request itself', () => {
    expect(waitingNeed({ toolName: 'Bash', input: { command: 'npm publish' }, title: null })).toEqual({ kind: 'permission', title: 'Allow a command', text: 'Claude wants to run npm publish' });
    expect(waitingNeed({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which easing?' }, { question: 'Speed?' }] }, title: null })).toEqual({
      kind: 'question',
      title: 'Answer a question',
      text: 'Which easing? (and 1 more question)',
    });
    expect(waitingNeed({ toolName: 'ExitPlanMode', input: { plan: '…' }, title: null }).kind).toBe('permission');
  });
});

describe('the Haiku summary', () => {
  const rules = { signals: signals({ diff: { files: 2, add: 3, del: 1 } }), state: 'finished' as const, error: null };
  const answer = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({ did: ['- Added the **sort**'], skipped: [], need: { kind: 'commit', title: 'Commit the changes', text: 'Ready — commit it.' }, planDeviated: false, ...patch });

  it('takes valid JSON, in plain words', () => {
    expect(parseSummary(`Here you go:\n${answer()}`, rules)).toEqual({
      did: ['Added the sort'],
      skipped: [],
      need: { kind: 'commit', title: 'Commit the changes', text: 'Ready, commit it.' },
      planDeviated: false,
    });
  });

  it('refuses anything that isn’t the shape asked for', () => {
    expect(parseSummary('no json here', rules)).toBeNull();
    expect(parseSummary('{"did": [', rules)).toBeNull();
    expect(parseSummary(answer({ did: [] }), rules)).toBeNull();
    expect(parseSummary(answer({ did: ['1', '2', '3', '4', '5', '6'] }), rules)).toBeNull();
    expect(parseSummary(answer({ need: { kind: 'celebrate', title: 'x', text: 'y' } }), rules)).toBeNull();
    expect(parseSummary(answer({ planDeviated: 'no' }), rules)).toBeNull();
  });

  it('keeps the rules’ next step, except for a question back after a clean finish', () => {
    const failing = { ...rules, signals: signals({ diff: rules.signals.diff, tests: { state: 'failed' as const, passed: 7, failed: 2 } }) };
    expect(parseSummary(answer(), failing)!.need).toEqual({ kind: 'reply', title: 'Decide about the failing tests', text: '2 of 9 tests fail. Tell Claude how to go on.' });
    expect(parseSummary(answer({ need: { kind: 'reply', title: 'Answer the question', text: 'Claude asks which file.' } }), rules)!.need.kind).toBe('reply');
  });

  it('never sends file contents, diffs or command output', () => {
    const turn = turnOf({
      tools: [
        call({ name: 'Write', file: '/repo/secret.ts', exitCode: 0 }),
        call({ name: 'Read', file: '/repo/config.ts', exitCode: 0, output: 'const API_KEY = "FILE_CONTENTS"' }),
        call({ command: 'npm test', exitCode: 1, output: 'OUTPUT_OF_THE_RUN' }),
      ],
    });
    // The raw messages carry the contents; the turn read from them keeps only the output's tail.
    const messages = [
      user('p', 'Go'),
      assistant('a', [toolUse('w', 'Write', { file_path: '/repo/secret.ts', content: 'WRITTEN_CONTENTS' }), toolUse('r', 'Read', { file_path: '/repo/config.ts' })]),
      toolResult('w', 'ok'),
      toolResult('r', 'const API_KEY = "FILE_CONTENTS"'),
      assistant('b', [{ type: 'text', text: 'Done.' }]),
    ];
    for (const input of [summaryInput(turn, signals()), summaryInput(lastTurn(messages)!, signals())]) {
      expect(input).not.toContain('FILE_CONTENTS');
      expect(input).not.toContain('WRITTEN_CONTENTS');
      expect(input).not.toContain('OUTPUT_OF_THE_RUN');
    }
    expect(JSON.parse(summaryInput(turn, signals())).toolCalls).toEqual([
      { tool: 'Write', file: '/repo/secret.ts', exitCode: 0 },
      { tool: 'Read', file: '/repo/config.ts', exitCode: 0 },
      { tool: 'Bash', command: 'npm test', exitCode: 1 },
    ]);
  });

  it('has a stub for runs that must never call a model, in the shape Haiku answers', () => {
    const text = stubSummary(summaryInput(turnOf({ tools: [call({ name: 'Edit', file: '/repo/a.ts' })] }), signals()))!;
    expect(parseSummary(text, rules)).not.toBeNull();
  });
});

describe('why a session asks', () => {
  const ask = { title: null, description: null, toolUseId: 'w1' };
  it('shows Haiku a command, a path, a plan or the questions, never what an edit writes', () => {
    const turn = turnOf({ tools: [call({ id: 'w1', name: 'Write', file: '/repo/a.ts' })] });
    const edit = JSON.parse(whyInput(turn, { ...ask, toolName: 'Write', input: { file_path: '/repo/a.ts', content: 'SECRET_CONTENTS' } }));
    expect(edit.request).toEqual({ tool: 'Write', file: '/repo/a.ts' });
    expect(JSON.stringify(edit)).not.toContain('SECRET_CONTENTS');
    // The request isn't one of the calls so far.
    expect(edit.toolCalls).toEqual([]);
    expect(JSON.parse(whyInput(turn, { ...ask, toolName: 'Bash', input: { command: 'npm publish', description: 'Publish' } })).request).toEqual({ tool: 'Bash', command: 'npm publish', description: 'Publish' });
    const question = JSON.parse(whyInput(turn, { ...ask, toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which easing?', options: [{ label: 'Linear' }, { label: 'Ease' }] }] } }));
    expect(question.request.questions).toEqual([{ question: 'Which easing?', options: ['Linear', 'Ease'] }]);
  });

  it('reads Haiku\'s answer in plain words, or nothing', () => {
    expect(parseWhy('Sure: {"what": "Runs **npm publish** — it uploads the package.", "why": "You asked to release."}')).toEqual({ what: 'Runs npm publish, it uploads the package.', why: 'You asked to release.' });
    expect(parseWhy('{"what": ""}')).toBeNull();
    expect(parseWhy('no idea')).toBeNull();
  });
});
