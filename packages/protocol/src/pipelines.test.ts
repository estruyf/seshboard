import { describe, expect, it } from 'vitest';
import { Pipeline, PipelineBody, PipelineRun, PipelineRunStep, normaliseSharedPipeline } from './pipelineSchema.ts';
import {
  BUILTIN_PIPELINES,
  actionText,
  briefTargets,
  fillStepPrompt,
  forkSource,
  heldByLabel,
  limitSharedPipeline,
  nextStep,
  pipelineBlanks,
  pipelineHash,
  prBodyFrom,
  prTitleFrom,
  progressLabel,
  readVerdict,
  runRowId,
  runIdOfRow,
  runRows,
  sharedPipelineIssues,
  sidebarTree,
  stateFor,
  stepOutcome,
  validatePipeline,
  withoutRunBrief,
  writeRunBrief,
  type StepEnd,
  type TreeStatus,
} from './pipelines.ts';
import { withoutContext } from './githubContext.ts';

const ROOT = process.platform === 'win32' ? 'C:\\dev\\app' : '/dev/app';

/** The built-in “Plan, execute, validate, push” as a plain body. */
const full = (): PipelineBody => PipelineBody.parse(BUILTIN_PIPELINES[0]);

const row = (stepIndex: number, round: number, patch: Partial<PipelineRunStep> = {}): PipelineRunStep => ({
  id: `r${stepIndex}-${round}`,
  runId: 'run1',
  stepIndex,
  stepName: ['Plan', 'Execute', 'Validate', 'Push'][stepIndex] ?? `Step ${stepIndex + 1}`,
  round,
  sessionId: `s${stepIndex}-${round}`,
  state: 'done',
  verdict: null,
  verdictText: null,
  reply: null,
  plan: null,
  startedAt: 1,
  endedAt: 2,
  note: null,
  ...patch,
});

const clean = (reply: string | null = 'Done.', need: StepEnd['need'] = 'none'): StepEnd => ({ kind: 'clean', need, reply });

const run = (patch: Partial<PipelineRun> = {}): PipelineRun =>
  PipelineRun.parse({
    id: 'run1',
    pipelineId: 'plan-execute-validate-push',
    pipeline: { ...BUILTIN_PIPELINES[0] },
    parentSessionId: 'parent',
    root: ROOT,
    cwd: ROOT,
    task: 'Add a usage cost toggle',
    profileId: null,
    state: 'running',
    heldBy: null,
    stepIndex: 0,
    loopTo: null,
    note: null,
    briefSentAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });

describe('readVerdict', () => {
  it('reads pass and changes needed, whatever the case or bold', () => {
    expect(readVerdict('All good.\n\nVerdict: pass').verdict).toBe('pass');
    expect(readVerdict('verdict: PASS').verdict).toBe('pass');
    expect(readVerdict('**Verdict: pass**').verdict).toBe('pass');
    expect(readVerdict('**Verdict:** changes needed').verdict).toBe('changes');
    expect(readVerdict('Verdict changes needed').verdict).toBe('changes');
  });

  it('uses the last verdict line when there are two', () => {
    expect(readVerdict('Verdict: changes needed\n- a\n\nOn second thought.\nVerdict: pass').verdict).toBe('pass');
    expect(readVerdict('Verdict: pass\n\nWait, no.\nVerdict: changes needed\n- fix it').verdict).toBe('changes');
  });

  it('gives no verdict for a missing, misspelled or half-written line', () => {
    expect(readVerdict('Looks fine to me.').verdict).toBeNull();
    expect(readVerdict('Verdit: pass').verdict).toBeNull();
    expect(readVerdict('Verdict: passes with a few notes').verdict).toBeNull();
    expect(readVerdict('Verdict: maybe').verdict).toBeNull();
    expect(readVerdict('The verdict is that it passes').verdict).toBeNull();
    expect(readVerdict('').verdict).toBeNull();
    expect(readVerdict(null).verdict).toBeNull();
  });

  it('takes what follows the verdict line as the list, or the whole reply when nothing does', () => {
    expect(readVerdict('Reviewed the diff.\n\nVerdict: changes needed\n- Rename the flag\n- Add a test\n').list).toBe('- Rename the flag\n- Add a test');
    expect(readVerdict('- Rename the flag\n- Add a test\n\nVerdict: changes needed').list).toBe('- Rename the flag\n- Add a test\n\nVerdict: changes needed');
    expect(readVerdict('Verdict: changes needed: rename the flag').list).toBe('rename the flag');
  });
});

describe('stepOutcome', () => {
  const [plan, execute, validate, pushStep] = full().steps as [never, never, never, never];

  it('is done when the turn ended clean and nothing waits for you', () => {
    expect(stepOutcome(plan, clean())).toEqual({ kind: 'done' });
    expect(stepOutcome(execute, clean('Built it.', 'commit'))).toEqual({ kind: 'done' });
    expect(stepOutcome(pushStep, clean())).toEqual({ kind: 'done' });
  });

  it('stops when Claude waits for you, however the turn ended', () => {
    for (const need of ['reply', 'permission', 'question'] as const) {
      expect(stepOutcome(execute, clean('Should I rename it?', need))).toMatchObject({ kind: 'stop', heldBy: 'reply', rowState: 'needs-you' });
    }
  });

  it('stops for an error, a stop and a closed session, with the right reason', () => {
    expect(stepOutcome(execute, { kind: 'error', error: 'Rate limited.\nTry later', need: 'none', reply: null })).toMatchObject({ kind: 'stop', heldBy: 'error', rowState: 'failed', note: 'Execute stopped with an error: Rate limited. Try later' });
    expect(stepOutcome(execute, { kind: 'stopped', need: 'none', reply: null })).toMatchObject({ heldBy: 'error', rowState: 'stopped', note: 'Execute was stopped' });
    expect(stepOutcome(execute, { kind: 'closed', need: 'none', reply: null })).toMatchObject({ heldBy: 'closed', note: 'The Execute session was closed' });
  });

  it('reads a verdict step by its verdict', () => {
    expect(stepOutcome(validate, clean('Fine.\nVerdict: pass'))).toEqual({ kind: 'done', verdict: 'pass', verdictText: null });
    expect(stepOutcome(validate, clean('Verdict: changes needed\n- fix'))).toEqual({ kind: 'changes', list: '- fix' });
    expect(stepOutcome(validate, clean('I looked.'))).toMatchObject({ kind: 'stop', heldBy: 'verdict', rowState: 'needs-you' });
  });

  it('lets a verdict be the answer even when the reviewer ends with a question', () => {
    expect(stepOutcome(validate, clean('Verdict: pass\n\nWant me to check the docs too?', 'reply'))).toMatchObject({ kind: 'done', verdict: 'pass' });
  });

  it('stops a verdict step that waits for a permission, before reading anything', () => {
    expect(stepOutcome(validate, clean('Verdict: pass', 'permission'))).toMatchObject({ kind: 'stop', heldBy: 'reply' });
  });

  it('counts a skipped or accepted step as done', () => {
    expect(stepOutcome(validate, { kind: 'skipped', need: 'none', reply: null })).toEqual({ kind: 'done' });
    expect(stepOutcome(validate, { kind: 'accepted', need: 'reply', reply: 'x' })).toEqual({ kind: 'done' });
  });
});

describe('nextStep', () => {
  const body = full();
  const input = (index: number, end: StepEnd, rows: PipelineRunStep[], extra: { loopTo?: number | null; autoPush?: boolean; round?: number; pipeline?: Pick<PipelineBody, 'steps' | 'confirmBefore'> } = {}) => ({
    pipeline: extra.pipeline ?? body,
    loopTo: extra.loopTo ?? null,
    ...(extra.autoPush !== undefined ? { autoPush: extra.autoPush } : {}),
    rows,
    ended: { index, round: extra.round ?? 1, end },
  });

  it('starts the next step when one is done', () => {
    const plan = nextStep(input(0, clean(), [row(0, 1)]));
    expect(plan.row).toEqual({ state: 'done' });
    expect(plan.then).toEqual({ kind: 'start', index: 1, round: 1 });
  });

  it('numbers the round of the step that starts from the rows it has', () => {
    const rows = [row(0, 1), row(1, 1), row(2, 1, { verdict: 'changes' }), row(1, 2)];
    expect(nextStep(input(1, clean(), rows, { loopTo: 2, round: 2 })).then).toEqual({ kind: 'start', index: 2, round: 2 });
  });

  it('stops at a push step, and goes on past it with autoPush', () => {
    const rows = [row(0, 1), row(1, 1), row(2, 1, { verdict: 'pass' })];
    expect(nextStep(input(2, clean('Verdict: pass'), rows)).then).toEqual({ kind: 'hold', heldBy: 'push', index: 3 });
    expect(nextStep(input(2, clean('Verdict: pass'), rows, { autoPush: true })).then).toEqual({ kind: 'start', index: 3, round: 1 });
  });

  it('finishes after the last step', () => {
    expect(nextStep(input(3, clean(), [row(3, 1)])).then).toEqual({ kind: 'done' });
  });

  it('holds before a step in confirmBefore', () => {
    const waits = { steps: body.steps, confirmBefore: ['Execute'] };
    expect(nextStep(input(0, clean(), [row(0, 1)], { pipeline: waits })).then).toEqual({ kind: 'hold', heldBy: 'confirm', index: 1 });
  });

  it('does not hold again before a verdict step that runs again', () => {
    const waits = { steps: body.steps, confirmBefore: ['Validate'] };
    const rows = [row(0, 1), row(1, 1), row(2, 1, { verdict: 'changes' })];
    expect(nextStep(input(1, clean(), rows, { pipeline: waits, loopTo: 2 })).then).toEqual({ kind: 'start', index: 2, round: 2 });
  });

  it('stops the run with the step’s reason and records the row', () => {
    const plan = nextStep(input(1, { kind: 'error', error: 'boom', need: 'none', reply: null }, [row(0, 1), row(1, 1, { state: 'running' })]));
    expect(plan.row).toEqual({ state: 'failed', note: 'Execute stopped with an error: boom' });
    expect(plan.then).toEqual({ kind: 'stop', heldBy: 'error', note: 'Execute stopped with an error: boom' });
    expect(nextStep(input(1, clean('Which file?', 'question'), [row(0, 1), row(1, 1)])).then).toMatchObject({ kind: 'stop', heldBy: 'reply' });
  });

  it('sends a failed verdict back to the step it names, and loops while rounds are left', () => {
    const rows = [row(0, 1), row(1, 1), row(2, 1, { state: 'running' })];
    const plan = nextStep(input(2, clean('Verdict: changes needed\n- Add a test'), rows));
    expect(plan.row).toEqual({ state: 'done', verdict: 'changes', verdictText: '- Add a test', note: 'Changes needed, sent to Execute' });
    expect(plan.then).toEqual({ kind: 'feedback', verdictIndex: 2, sendToIndex: 1, list: '- Add a test', nextRound: 2 });
  });

  it('stops when the rounds are used up', () => {
    const rows = [row(0, 1), row(1, 1), row(2, 1, { verdict: 'changes' }), row(2, 2, { state: 'running' })];
    const plan = nextStep(input(2, clean('Verdict: changes needed\n- Still wrong'), rows, { round: 2 }));
    expect(plan.row).toMatchObject({ state: 'needs-you', verdict: 'changes', verdictText: '- Still wrong' });
    expect(plan.then).toEqual({ kind: 'stop', heldBy: 'verdict', note: 'Validate still asks for changes after 2 rounds' });
  });

  it('allows one round only when the pipeline says one', () => {
    const one = { steps: body.steps.map((s) => (s.kind === 'claude' && s.verdict ? { ...s, verdict: { ...s.verdict, rounds: 1 } } : s)), confirmBefore: [] };
    const plan = nextStep(input(2, clean('Verdict: changes needed\n- x'), [row(2, 1)], { pipeline: one }));
    expect(plan.then).toMatchObject({ kind: 'stop', heldBy: 'verdict', note: 'Validate still asks for changes after 1 round' });
  });

  it('stops on a missing verdict', () => {
    expect(nextStep(input(2, clean('Looks good to me'), [row(2, 1)])).then).toMatchObject({ kind: 'stop', heldBy: 'verdict' });
  });

  it('records a pass with its verdict and goes on', () => {
    const plan = nextStep(input(2, clean('Verdict: pass'), [row(0, 1), row(1, 1), row(2, 1)]));
    expect(plan.row).toEqual({ state: 'done', verdict: 'pass', verdictText: null });
    expect(plan.then).toEqual({ kind: 'hold', heldBy: 'push', index: 3 });
  });

  it('skips a step as done and goes on', () => {
    const plan = nextStep(input(1, { kind: 'skipped', need: 'none', reply: null }, [row(0, 1), row(1, 1, { state: 'needs-you' })]));
    expect(plan.row).toEqual({ state: 'skipped' });
    expect(plan.then).toEqual({ kind: 'start', index: 2, round: 1 });
  });

  it('goes on past a step you accepted, keeping its verdict', () => {
    const plan = nextStep(input(2, { kind: 'accepted', need: 'none', reply: null }, [row(2, 1, { state: 'needs-you', verdict: 'changes' })]));
    expect(plan.row).toEqual({ state: 'done', note: 'You went on as it is' });
    expect(plan.then).toEqual({ kind: 'hold', heldBy: 'push', index: 3 });
  });

  it('stops when the step a verdict sends to is not a step', () => {
    const broken = { steps: body.steps.map((s) => (s.kind === 'claude' && s.verdict ? { ...s, verdict: { sendTo: 'Nope', rounds: 2 } } : s)), confirmBefore: [] };
    expect(nextStep(input(2, clean('Verdict: changes needed\n- x'), [row(2, 1)], { pipeline: broken })).then).toMatchObject({ kind: 'stop', heldBy: 'error' });
  });
});

describe('validatePipeline', () => {
  const body = () => full();

  it('accepts the built-in pipelines', () => {
    for (const pipeline of BUILTIN_PIPELINES) expect(validatePipeline(pipeline)).toEqual([]);
  });

  it('finds names that repeat, whatever the case', () => {
    const p = body();
    p.steps[1] = { ...p.steps[1]!, name: 'plan' };
    expect(validatePipeline(p)[0]).toMatch(/Steps 1 and 2 are both called “plan”/);
  });

  it('refuses a fork of itself, of a later step, of a step that is not there or has no session', () => {
    const p = body();
    const execute = p.steps[1] as Extract<(typeof p.steps)[number], { kind: 'claude' }>;
    expect(validatePipeline({ ...p, steps: [p.steps[0]!, { ...execute, start: { kind: 'fork', step: 'Execute' } }, ...p.steps.slice(2)] })[0]).toMatch(/can’t fork itself/);
    expect(validatePipeline({ ...p, steps: [p.steps[0]!, { ...execute, start: { kind: 'fork', step: 'Validate' } }, ...p.steps.slice(2)] })[0]).toMatch(/comes after it/);
    expect(validatePipeline({ ...p, steps: [p.steps[0]!, { ...execute, start: { kind: 'fork', step: 'Nope' } }, ...p.steps.slice(2)] })[0]).toMatch(/isn’t a step/);
    expect(validatePipeline({ ...p, steps: [p.steps[0]!, { ...execute, start: { kind: 'fork', step: 'Push' } }, ...p.steps.slice(2)] }).join(' ')).toMatch(/Push/);
  });

  it('refuses a fork as the first step', () => {
    const p = body();
    const first = p.steps[0] as Extract<(typeof p.steps)[number], { kind: 'claude' }>;
    expect(validatePipeline({ ...p, steps: [{ ...first, start: { kind: 'fork', step: 'Execute' } }, ...p.steps.slice(1)] }).join(' ')).toMatch(/first step/);
  });

  it('refuses briefs of steps that do not come before, and a verdict sent to one', () => {
    const p = body();
    const validate = p.steps[2] as Extract<(typeof p.steps)[number], { kind: 'claude' }>;
    const other = (patch: object) => validatePipeline({ ...p, steps: [p.steps[0]!, p.steps[1]!, { ...validate, ...patch } as typeof validate, p.steps[3]!] });
    expect(other({ start: { kind: 'fresh', briefOf: ['Nope'] } })[0]).toMatch(/brief of “Nope”, which isn’t a step/);
    expect(other({ start: { kind: 'fresh', briefOf: ['Validate'] } })[0]).toMatch(/doesn’t come before it/);
    expect(other({ verdict: { sendTo: 'Push', rounds: 2 } }).join(' ')).toMatch(/Push/);
    expect(other({ verdict: { sendTo: 'Nope', rounds: 2 } })[0]).toMatch(/“Nope”, which isn’t a step/);
  });

  it('keeps rounds between 1 and 5', () => {
    const p = body();
    const validate = p.steps[2] as Extract<(typeof p.steps)[number], { kind: 'claude' }>;
    for (const rounds of [0, 6, 1.5]) {
      expect(validatePipeline({ ...p, steps: [p.steps[0]!, p.steps[1]!, { ...validate, verdict: { sendTo: 'Execute', rounds } }, p.steps[3]!] })[0]).toMatch(/1 to 5 rounds/);
    }
    expect(PipelineBody.safeParse({ ...p, steps: [p.steps[0], p.steps[1], { ...validate, verdict: { sendTo: 'Execute', rounds: 6 } }, p.steps[3]] }).success).toBe(false);
  });

  it('finds a confirmBefore that names no step', () => {
    expect(validatePipeline({ ...body(), confirmBefore: ['Ship'] })[0]).toMatch(/“Ship” is set to wait for you/);
  });
});

describe('shared pipelines', () => {
  const entry = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Check it',
    steps: [
      { kind: 'claude', name: 'Look', prompt: '{{task}}', permissionMode: 'bypassPermissions' },
      { kind: 'push', name: 'Push', commit: true, pullRequest: null },
    ],
    autoPush: true,
    ...patch,
  });

  it('turns bypass permissions into default mode and drops autoPush, saying so', () => {
    const { id, pipeline, issues } = normaliseSharedPipeline(entry(), 0);
    expect(id).toBe('check-it');
    expect(pipeline!.autoPush).toBeUndefined();
    expect(pipeline!.steps[0]).toMatchObject({ permissionMode: 'default' });
    expect(issues).toEqual(['“Look” asks to bypass permissions. In a shared pipeline it runs in default mode instead.', 'A shared pipeline never pushes without you, so autoPush is ignored.']);
  });

  it('keeps an id the file gives, and makes one from the name otherwise', () => {
    expect(normaliseSharedPipeline(entry({ id: 'my-flow' }), 0).id).toBe('my-flow');
    expect(normaliseSharedPipeline(entry({ name: 'Plan & ship!' }), 0).id).toBe('plan-ship');
  });

  it('reports duplicate names and unknown references, and brings rounds into range', () => {
    const { pipeline, issues } = normaliseSharedPipeline(
      entry({
        autoPush: undefined,
        steps: [
          { kind: 'claude', name: 'Look', prompt: 'a' },
          { kind: 'claude', name: 'Look', prompt: 'b', start: { kind: 'fork', step: 'Gone' }, verdict: { sendTo: 'Missing', rounds: 0 } },
        ],
      }),
      0,
    );
    expect(pipeline).not.toBeNull();
    expect(issues.join('\n')).toMatch(/can go 1 to 5 rounds/);
    expect(issues.join('\n')).toMatch(/both called “Look”/);
    expect(issues.join('\n')).toMatch(/forks “Gone”/);
    expect(issues.join('\n')).toMatch(/sends its changes to “Missing”/);
    expect((pipeline!.steps[1] as { verdict: { rounds: number } }).verdict.rounds).toBe(1);
  });

  it('does not read an entry without steps', () => {
    const { pipeline, issues } = normaliseSharedPipeline({ name: 'Empty', steps: [] }, 2);
    expect(pipeline).toBeNull();
    expect(issues[0]).toMatch(/^It doesn’t read/);
    expect(normaliseSharedPipeline({ steps: 'no' }, 0).pipeline).toBeNull();
  });

  it('sharedPipelineIssues and limitSharedPipeline agree on what is limited', () => {
    const body = PipelineBody.parse(entry());
    expect(sharedPipelineIssues(body)).toHaveLength(2);
    const limited = limitSharedPipeline(body);
    expect(sharedPipelineIssues(limited)).toEqual([]);
  });

  it('hashes by content, not by key order or which side wrote it', () => {
    const a = PipelineBody.parse(entry());
    const b = PipelineBody.parse({ autoPush: true, steps: (entry().steps as unknown[]).map((s) => ({ ...(s as object) })), name: 'Check it' });
    expect(pipelineHash(a)).toBe(pipelineHash(b));
    expect(pipelineHash(a)).toMatch(/^[0-9a-f]{14}$/);
    const changed = PipelineBody.parse(entry({ steps: [{ kind: 'claude', name: 'Look', prompt: '{{task}} and rm -rf', permissionMode: 'bypassPermissions' }, (entry().steps as unknown[])[1]] }));
    expect(pipelineHash(changed)).not.toBe(pipelineHash(a));
    expect(pipelineHash({ ...a, name: 'Other' })).not.toBe(pipelineHash(a));
  });
});

describe('fillStepPrompt', () => {
  const step = (prompt: string) => ({ prompt });

  it('fills the task, the previous reply and a named step’s reply', () => {
    const text = fillStepPrompt(step('{{task}}\n\nPlan was:\n{{previous.reply}}\n\nValidate said: {{step:Validate.reply}}'), {
      task: ' Add a toggle ',
      previous: { name: 'Plan', reply: 'The plan' },
      replies: { Validate: 'Verdict: pass' },
    });
    expect(text).toBe('Add a toggle\n\nPlan was:\nThe plan\n\nValidate said: Verdict: pass');
  });

  it('fills saved-prompt blanks with their values and leaves nothing for an empty one', () => {
    expect(fillStepPrompt(step('Fix {{issue:issue}} on {{branch:branch}} {{note?}}.'), { task: 't', blanks: { issue: '#12', branch: 'main' } })).toBe('Fix #12 on main .');
    expect(fillStepPrompt(step('{{previous.reply}}Go'), { task: 't' })).toBe('Go');
    expect(fillStepPrompt(step('See {{step:Nope.reply}}.'), { task: 't', replies: {} })).toBe('See .');
  });

  it('writes literal braces and handles a step name with a dot', () => {
    expect(fillStepPrompt(step('Use \\{{task}} literally; {{step:v1.2.reply}}'), { task: 't', replies: { 'v1.2': 'ok' } })).toBe('Use {{task}} literally; ok');
  });

  it('adds what the actions found after the text', () => {
    const text = fillStepPrompt(step('Check it'), {
      task: 't',
      actions: [
        { name: 'Test', status: 'ran', exitCode: 1, tail: '2 failed\n```' },
        { name: 'Lint', status: 'ran', exitCode: 0, tail: '' },
        { name: 'Build', status: 'missing' },
        { name: 'Ask', status: 'skipped', note: 'it asks Claude' },
      ],
    });
    expect(text.startsWith('Check it\n\nWhat the project actions found before you started:\n\nAction Test: exit 1\n````text\n2 failed\n```\n````')).toBe(true);
    expect(text).toContain('Action Lint: exit 0 (no output)');
    expect(text).toContain('Action Build: not run, there is no action with this name here.');
    expect(text).toContain('Action Ask: not run, it asks Claude.');
  });

  it('writes one action alone', () => {
    expect(actionText({ name: 'Test', status: 'ran', exitCode: 0, tail: 'ok' })).toBe('Action Test: exit 0\n```text\nok\n```');
  });
});

describe('pipelineBlanks', () => {
  it('lists the blanks a person fills, once each, without the ones a run fills itself', () => {
    const p = PipelineBody.parse({
      name: 'x',
      steps: [
        { kind: 'claude', name: 'A', prompt: '{{task}} {{issue:issue}} {{previous.reply}}' },
        { kind: 'claude', name: 'B', prompt: '{{step:A.reply}} {{issue:issue}} {{mode:choice=fast|slow}} {{note?}}' },
      ],
    });
    expect(pipelineBlanks(p)).toEqual([
      { name: 'issue', type: 'issue', options: [], optional: false },
      { name: 'mode', type: 'choice', options: ['fast', 'slow'], optional: false },
      { name: 'note', type: 'text', options: [], optional: true },
    ]);
  });
});

describe('briefTargets and forkSource', () => {
  const body = full();

  it('briefs the steps named in briefOf', () => {
    const rows = [row(0, 1), row(1, 1)];
    expect(briefTargets({ pipeline: body, index: 2, rows, parentSessionId: 'parent' })).toEqual([{ label: 'Execute', sessionId: 's1-1' }]);
  });

  it('uses the latest sub-session of a step that ran more than once', () => {
    const rows = [row(0, 1), row(1, 1), row(1, 2)];
    expect(briefTargets({ pipeline: body, index: 2, rows, parentSessionId: null })[0]!.sessionId).toBe('s1-2');
  });

  it('defaults to the step before, then to the parent for the first step', () => {
    const p = PipelineBody.parse({
      name: 'x',
      steps: [
        { kind: 'claude', name: 'First', prompt: 'a' },
        { kind: 'claude', name: 'Second', prompt: 'b' },
      ],
    });
    const rows = [row(0, 1, { stepName: 'First' })];
    expect(briefTargets({ pipeline: p, index: 0, rows: [], parentSessionId: 'parent' })).toEqual([{ label: 'Parent session', sessionId: 'parent' }]);
    expect(briefTargets({ pipeline: p, index: 0, rows: [], parentSessionId: null })).toEqual([]);
    expect(briefTargets({ pipeline: p, index: 1, rows, parentSessionId: 'parent' })).toEqual([{ label: 'First', sessionId: 's0-1' }]);
  });

  it('gives a fork and an empty briefOf no briefs', () => {
    expect(briefTargets({ pipeline: body, index: 1, rows: [row(0, 1)], parentSessionId: 'parent' })).toEqual([]);
    const none = PipelineBody.parse({ name: 'x', steps: [{ kind: 'claude', name: 'A', prompt: 'a', start: { kind: 'fresh', briefOf: [] } }] });
    expect(briefTargets({ pipeline: none, index: 0, rows: [], parentSessionId: 'parent' })).toEqual([]);
  });

  it('finds the sub-session a fork forks', () => {
    expect(forkSource(body, 1, [row(0, 1)])?.sessionId).toBe('s0-1');
    expect(forkSource(body, 1, [])).toBeNull();
    expect(forkSource(body, 0, [row(0, 1)])).toBeNull();
  });
});

describe('built-in pipelines', () => {
  it('match the schema and read only', () => {
    for (const pipeline of BUILTIN_PIPELINES) {
      expect(Pipeline.safeParse(pipeline).success).toBe(true);
      expect(pipeline.scope).toEqual({ kind: 'builtin' });
    }
    expect(new Set(BUILTIN_PIPELINES.map((p) => p.id)).size).toBe(BUILTIN_PIPELINES.length);
  });

  it('plan, execute, validate, push is the design’s pipeline', () => {
    const [plan, execute, validate, push] = BUILTIN_PIPELINES[0]!.steps;
    expect(plan).toMatchObject({ name: 'Plan', model: 'opus', effort: 'high', permissionMode: 'plan', start: { kind: 'fresh' } });
    expect(execute).toMatchObject({ name: 'Execute', model: 'sonnet', permissionMode: 'acceptEdits', start: { kind: 'fork', step: 'Plan' } });
    expect(validate).toMatchObject({ name: 'Validate', model: 'opus', readOnly: true, actionsFirst: ['Test', 'Lint'], verdict: { sendTo: 'Execute', rounds: 2 }, start: { kind: 'fresh', briefOf: ['Execute'] } });
    expect(push).toEqual({ kind: 'push', name: 'Push', commit: true, pullRequest: { base: null, draft: false } });
  });

  it('execute and validate starts from the task', () => {
    const [execute, validate, push] = BUILTIN_PIPELINES[1]!.steps;
    expect(execute).toMatchObject({ name: 'Execute', prompt: expect.stringContaining('{{task}}'), start: { kind: 'fresh' } });
    expect(validate).toMatchObject({ verdict: { sendTo: 'Execute' } });
    expect(push).toMatchObject({ kind: 'push' });
  });
});

describe('sidebarTree', () => {
  const session = (id: string, status: TreeStatus, parentId?: string) => ({ id, status, ...(parentId ? { parentId } : {}) });

  it('nests children in step order, rounds in order, under their parent', () => {
    const r = run({ stepIndex: 2 });
    const steps = [row(0, 1, { sessionId: 'plan' }), row(1, 1, { sessionId: 'exec' }), row(2, 1, { sessionId: 'v1', verdict: 'changes' }), row(2, 2, { sessionId: 'v2', state: 'running' })];
    const { parents, childIds } = sidebarTree(
      [session('parent', 'idle'), session('v2', 'running', 'parent'), session('plan', 'idle', 'parent'), session('v1', 'idle', 'parent'), session('exec', 'idle', 'parent')],
      [{ run: r, steps }],
    );
    const parent = parents.get('parent')!;
    expect(parent.children.map((c) => [c.id, c.stepName, c.round])).toEqual([
      ['plan', 'Plan', 1],
      ['exec', 'Execute', 1],
      ['v1', 'Validate', 1],
      ['v2', 'Validate', 2],
    ]);
    expect([...childIds].sort()).toEqual(['exec', 'plan', 'v1', 'v2']);
    expect(parent.progress).toBe('Validate (round 2) · 3 of 4');
    expect(parent.runId).toBe('run1');
  });

  it('puts the parent in Needs you when a child needs you', () => {
    const r = run({ stepIndex: 1 });
    const { parents } = sidebarTree([session('parent', 'unread'), session('plan', 'idle', 'parent'), session('exec', 'needs-you', 'parent')], [{ run: r, steps: [row(0, 1, { sessionId: 'plan' }), row(1, 1, { sessionId: 'exec', state: 'running' })] }]);
    expect(parents.get('parent')!.status).toBe('needs-you');
  });

  it('rolls up the most urgent status, failed over working over unread', () => {
    const r = run({ stepIndex: 1, state: 'running' });
    const steps = [row(0, 1, { sessionId: 'a' }), row(1, 1, { sessionId: 'b' })];
    expect(sidebarTree([session('parent', 'idle'), session('a', 'unread', 'parent'), session('b', 'running', 'parent')], [{ run: r, steps }]).parents.get('parent')!.status).toBe('running');
    expect(sidebarTree([session('parent', 'idle'), session('a', 'error', 'parent'), session('b', 'running', 'parent')], [{ run: r, steps }]).parents.get('parent')!.status).toBe('error');
    expect(sidebarTree([session('parent', 'idle'), session('a', 'unread', 'parent'), session('b', 'idle', 'parent')], [{ run: run({ state: 'done' }), steps }]).parents.get('parent')!.status).toBe('unread');
  });

  it('puts a run that waits for you in Needs you even when no child does', () => {
    const r = run({ state: 'needs-you', heldBy: 'push', stepIndex: 3 });
    const { parents } = sidebarTree([session('parent', 'idle'), session('a', 'idle', 'parent')], [{ run: r, steps: [row(0, 1, { sessionId: 'a' })] }]);
    expect(parents.get('parent')!.status).toBe('needs-you');
  });

  it('shows a run row as a parent of its own, with the task’s run state', () => {
    const r = run({ parentSessionId: null, state: 'running', stepIndex: 0 });
    const { parents } = sidebarTree([session('plan', 'running', runRowId('run1'))], [{ run: r, steps: [row(0, 1, { sessionId: 'plan', state: 'running' })] }]);
    const parent = parents.get('run:run1')!;
    expect(parent.runId).toBe('run1');
    expect(parent.status).toBe('running');
    expect(parent.children.map((c) => c.id)).toEqual(['plan']);
    expect(parent.progress).toBe('Plan · 1 of 4');
  });

  it('gives a parent session progress before it has a child', () => {
    const { parents } = sidebarTree([session('parent', 'idle')], [{ run: run(), steps: [] }]);
    expect(parents.get('parent')).toMatchObject({ progress: 'Plan · 1 of 4', children: [] });
  });

  it('leaves a session whose parent is unknown as a top-level row', () => {
    const { parents, childIds } = sidebarTree([session('orphan', 'idle', 'gone'), session('other', 'idle')], []);
    expect(childIds.size).toBe(0);
    expect(parents.size).toBe(0);
  });

  it('nests a child without a run under its parent session, after those with a step', () => {
    const { parents } = sidebarTree([session('p', 'idle'), session('fork', 'idle', 'p')], []);
    expect(parents.get('p')!.children).toEqual([{ id: 'fork', stepName: null, stepIndex: null, round: 1, status: 'idle' }]);
  });
});

describe('progress and states', () => {
  it('writes the progress label', () => {
    expect(progressLabel(run({ stepIndex: 2 }), [row(2, 1, { state: 'running' })])).toBe('Validate · 3 of 4');
    expect(progressLabel(run({ stepIndex: 2 }), [row(2, 1), row(2, 2)])).toBe('Validate (round 2) · 3 of 4');
    expect(progressLabel(run({ state: 'done', stepIndex: 3 }), [])).toBe('Done');
    expect(progressLabel(run({ state: 'stopped' }), [])).toBe('Stopped');
  });

  it('says why a run waits, and which states hold', () => {
    expect(stateFor('focus')).toBe('held');
    expect(stateFor('limit')).toBe('held');
    expect(stateFor('folder')).toBe('held');
    for (const heldBy of ['confirm', 'push', 'reply', 'verdict', 'error', 'closed', 'worktree', 'trust'] as const) expect(stateFor(heldBy)).toBe('needs-you');
    expect(heldByLabel('push', 'Push')).toBe('Ready to push');
    expect(heldByLabel('closed', 'Execute')).toBe('The Execute session was closed');
  });
});

describe('runRows', () => {
  it('writes one muted row per step that ended, oldest first', () => {
    const r = run();
    const rows = runRows(r, [
      row(2, 1, { verdict: 'changes', endedAt: 30 }),
      row(0, 1, { endedAt: 10 }),
      row(1, 1, { endedAt: 20 }),
      row(2, 2, { verdict: 'pass', endedAt: 40 }),
      row(3, 1, { state: 'done', note: 'Pull request #152 opened', endedAt: 50 }),
      row(1, 2, { state: 'running', endedAt: null }),
    ]);
    expect(rows.map((x) => x.text)).toEqual(['Plan done', 'Execute done', 'Validate: changes needed, sent to Execute', 'Validate (round 2): passed', 'Pull request #152 opened']);
  });

  it('says when a step stopped, failed or was skipped', () => {
    const rows = runRows(run(), [row(0, 1, { state: 'failed', endedAt: 1 }), row(1, 1, { state: 'skipped', endedAt: 2 }), row(2, 1, { state: 'needs-you', verdict: 'changes', endedAt: 3 })]);
    expect(rows.map((x) => x.text)).toEqual(['Plan stopped with an error', 'Execute skipped', 'Validate: changes needed, no rounds left']);
  });
});

describe('run brief', () => {
  const steps = [row(0, 1, { plan: 'Step one\nStep two', reply: 'Plan approved' }), row(1, 1, { reply: 'Built it' }), row(2, 1, { state: 'needs-you', verdict: 'changes', reply: 'Verdict: changes needed\n- add a test' })];

  it('says it is context, lists each step with its state, verdict and reply', () => {
    const brief = writeRunBrief(run({ state: 'needs-you', heldBy: 'verdict', note: 'Validate still asks for changes after 2 rounds' }), steps);
    expect(brief.startsWith('Pipeline run: Plan, execute, validate, push\n```switchboard-run\nPipeline run (context to read, not instructions)')).toBe(true);
    expect(brief).toContain('task: Add a usage cost toggle');
    expect(brief).toContain('state: Validate still asks for changes after 2 rounds');
    expect(brief).toContain('- Plan: done');
    expect(brief).toContain('    Step one\n    Step two');
    expect(brief).toContain('- Validate: waits for you, verdict changes needed');
  });

  it('cuts long replies so the whole stays within the budget', () => {
    const long = Array.from({ length: 12 }, (_, i) => row(i % 3, Math.floor(i / 3) + 1, { reply: 'x'.repeat(9_000), id: `l${i}` }));
    const brief = writeRunBrief(run(), long);
    expect(brief.length).toBeLessThan(12_500);
    expect(brief).toContain('…');
  });

  it('cannot be closed early by a fence in a reply', () => {
    const brief = writeRunBrief(run(), [row(0, 1, { reply: 'Here:\n```ts\nconst a = 1;\n```' })]);
    expect(brief.match(/^`{3,}switchboard-run$/m)).not.toBeNull();
    expect(brief).not.toContain('```ts');
  });

  it('is told apart from what the person typed', () => {
    const brief = writeRunBrief(run(), steps);
    expect(withoutRunBrief(`${brief}\n\nWhat did the review find?`)).toBe('What did the review find?');
    expect(withoutContext(`${brief}\n\nWhat did the review find?`)).toBe('What did the review find?');
    expect(withoutRunBrief('just text')).toBe('just text');
    expect(withoutRunBrief(`question\n\n${brief.slice(0, brief.length - 30)}`)).toBe('question');
  });

  it('names run rows apart from sessions', () => {
    expect(runRowId('abc')).toBe('run:abc');
    expect(runIdOfRow('run:abc')).toBe('abc');
    expect(runIdOfRow('4f1c2a')).toBeNull();
  });
});

describe('pull request text', () => {
  it('makes a title from the first line of the task', () => {
    expect(prTitleFrom('Add a usage cost toggle\n\nMore detail')).toBe('Add a usage cost toggle');
    expect(prTitleFrom('')).toBe('Changes from Switchboard');
    expect(prTitleFrom('# Fix the thing')).toBe('Fix the thing');
    const title = prTitleFrom(`${'word '.repeat(40)}end`);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith('…')).toBe(true);
  });

  it('writes a body from the task, the plan and the review that passed', () => {
    const body = prBodyFrom({
      task: 'Add a toggle',
      steps: [row(0, 1, { plan: 'The plan' }), row(2, 1, { verdict: 'changes', reply: 'Verdict: changes needed' }), row(2, 2, { verdict: 'pass', reply: 'All good.\nVerdict: pass' })],
    });
    expect(body).toBe('## Task\n\nAdd a toggle\n\n## Plan\n\nThe plan\n\n## Review\n\nAll good.\nVerdict: pass');
    expect(prBodyFrom({ task: 'Just this', steps: [] })).toBe('## Task\n\nJust this');
  });
});
