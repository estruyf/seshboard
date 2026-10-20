import { describe, expect, it } from 'vitest';
import { promptAsk, promptKind, promptLine, promptShort, promptSubject, promptTag, toolLabel } from './prompts.ts';

describe('prompt wording', () => {
  it('tags what a prompt asks for', () => {
    expect(promptTag({ toolName: 'Bash' })).toBe('Allow a command');
    expect(promptTag({ toolName: 'Edit' })).toBe('Allow an edit');
    expect(promptTag({ toolName: 'Write' })).toBe('Allow an edit');
    expect(promptTag({ toolName: 'WebFetch' })).toBe('Allow a fetch');
    expect(promptTag({ toolName: 'AskUserQuestion' })).toBe('Question');
    expect(promptTag({ toolName: 'ExitPlanMode' })).toBe('Plan');
    expect(promptTag({ toolName: 'mcp__github__create_issue' })).toBe('Allow create_issue');
  });

  it('tells tools, questions and plans apart', () => {
    expect([promptKind({ toolName: 'Bash' }), promptKind({ toolName: 'AskUserQuestion' }), promptKind({ toolName: 'ExitPlanMode' })]).toEqual(['tool', 'question', 'plan']);
    expect(toolLabel('Read')).toBe('Read');
  });

  it('gives the command or the file for the code box', () => {
    expect(promptSubject({ toolName: 'Bash', input: { command: 'npm publish --tag beta\necho done' } })).toBe('npm publish --tag beta');
    expect(promptSubject({ toolName: 'Edit', input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } })).toBe('src/app.ts');
  });

  it('gives the first line of a question or a plan', () => {
    expect(promptLine({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which database?\nMore' }, { question: 'Second' }] } })).toBe('Which database?');
    expect(promptLine({ toolName: 'ExitPlanMode', input: { plan: '\n# Plan: move the login\n1. Step' } })).toBe('Plan: move the login');
    expect(promptLine({ toolName: 'AskUserQuestion', input: null })).toBe('');
  });
});

describe('promptAsk', () => {
  it('says what a prompt asks, for the line it folds to while you type', () => {
    expect(promptAsk({ toolName: 'Bash' })).toBe('Allow Bash?');
    expect(promptAsk({ toolName: 'mcp__github__create_issue' })).toBe('Allow create_issue?');
    expect(promptAsk({ toolName: 'AskUserQuestion' })).toBe('A question');
    expect(promptAsk({ toolName: 'ExitPlanMode' })).toBe('A plan to start');
  });
});

describe('promptShort', () => {
  it('says in a few words what a prompt asks, for a sidebar row', () => {
    expect(promptShort({ toolName: 'Bash' })).toBe('Allow Bash');
    expect(promptShort({ toolName: 'mcp__github__create_issue' })).toBe('Allow create_issue');
    expect(promptShort({ toolName: 'AskUserQuestion' })).toBe('a question');
    expect(promptShort({ toolName: 'ExitPlanMode' })).toBe('a plan');
  });
});
