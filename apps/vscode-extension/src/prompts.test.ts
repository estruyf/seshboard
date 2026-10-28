import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@seshboard/protocol/companion-client';
import { alwaysText, newPrompts, promptKind, promptMessage, promptPlan, promptQuestions, questionAnswers } from './prompts.ts';

const request = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'r1',
  sessionId: 's1',
  toolName: 'Bash',
  toolUseId: null,
  input: { command: 'npm test' },
  title: null,
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: 0,
  ...over,
});

const ask = (questions: unknown[]) => request({ toolName: 'AskUserQuestion', input: { questions } as PermissionRequest['input'] });

describe('promptMessage', () => {
  it('says which session asks and what, with the command when the heading leaves it out', () => {
    expect(promptMessage(request(), 'Fix login')).toBe('Fix login: Claude wants to run a command: npm test');
    expect(promptMessage(request({ title: 'Claude wants to run npm test' }), 'Fix login')).toBe('Fix login: Claude wants to run npm test');
    expect(promptMessage(request({ toolName: 'Edit', input: { file_path: '/repo/src/auth.ts' } }), null)).toBe('Claude wants to edit auth.ts');
    expect(promptMessage(request({ agentId: 'a1', title: 'Claude wants to run npm test' }), null)).toBe('Claude wants to run npm test (from a subagent)');
  });

  it('keeps a long command to one short line', () => {
    const message = promptMessage(request({ input: { command: `echo ${'x'.repeat(300)}\nrm -rf build` } }), null);
    expect(message.length).toBeLessThan(220);
    expect(message).not.toContain('\n');
    expect(message.endsWith('…')).toBe(true);
  });

  it('heads questions and plans as their cards do', () => {
    expect(promptMessage(ask([{ question: 'Which database?', options: [] }]), 'S')).toBe('S: Claude has a question: Which database?');
    expect(promptMessage(ask([{ question: 'A?', options: [] }, { question: 'B?', options: [] }]), 'S')).toBe('S: Claude has 2 questions for you');
    expect(promptMessage(request({ toolName: 'ExitPlanMode', input: { plan: '# Plan' } }), 'S')).toBe('S: Claude has a plan. Ready to start?');
  });
});

describe('prompt input', () => {
  it('tells permissions, questions and plans apart', () => {
    expect(promptKind({ toolName: 'Bash' })).toBe('tool');
    expect(promptKind({ toolName: 'AskUserQuestion' })).toBe('question');
    expect(promptKind({ toolName: 'ExitPlanMode' })).toBe('plan');
  });

  it('reads questions and plans, and survives input it does not expect', () => {
    expect(promptQuestions(ask([{ question: 'Q?', options: [{ label: 'A' }, { nope: 1 }] }, { bad: true }]))).toEqual([{ question: 'Q?', options: [{ label: 'A' }] }]);
    expect(promptQuestions(request({ input: null }))).toEqual([]);
    expect(promptPlan(request({ input: { plan: '# Plan' } }))).toBe('# Plan');
    expect(promptPlan(request({ input: [] }))).toBe('');
  });

  it('answers every question, joining several picks with commas', () => {
    const r = ask([{ question: 'Which?', options: [] }, { question: 'Also?', multiSelect: true, options: [] }]);
    expect(questionAnswers(r, { 'Which?': ['Postgres'] })).toBeNull();
    expect(questionAnswers(r, { 'Which?': ['Postgres'], 'Also?': [' '] })).toBeNull();
    expect(questionAnswers(r, { 'Which?': ['Postgres'], 'Also?': ['Tests', 'Docs '] })).toEqual({
      questions: (r.input as { questions: unknown }).questions,
      answers: { 'Which?': 'Postgres', 'Also?': 'Tests, Docs' },
    });
  });

  it('words Always allow as the card does', () => {
    expect(alwaysText('Allow Bash(npm test:*) in this project')).toBe('Always allow Bash(npm test:*) in this project');
    expect(alwaysText('Edits in src/')).toBe('Always allow: Edits in src/');
  });
});

describe('newPrompts', () => {
  it('announces each prompt once, and forgets the ones that are gone', () => {
    const seen = new Set<string>();
    expect(newPrompts([request({ requestId: 'a' })], seen).map((p) => p.requestId)).toEqual(['a']);
    expect(newPrompts([request({ requestId: 'a' }), request({ requestId: 'b' })], seen).map((p) => p.requestId)).toEqual(['b']);
    expect(newPrompts([request({ requestId: 'b' })], seen)).toEqual([]);
    expect([...seen]).toEqual(['b']);
  });
});
