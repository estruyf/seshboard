import { describe, expect, it } from 'vitest';
import type { RemotePrompt } from '@switchboard/protocol/client';
import { promptKind, promptQuestions, promptSubject, promptTitle, questionDecision, toolLabel } from './computerPrompts.ts';

const prompt = (toolName: string, input: unknown, title: string | null = null): RemotePrompt => ({ requestId: 'r', sessionId: 's', toolName, input: input as RemotePrompt['input'], title, description: null, alwaysLabel: null, createdAt: 1 });

describe('another computer’s prompts', () => {
  it('says what each asks', () => {
    expect(promptKind(prompt('AskUserQuestion', {}))).toBe('question');
    expect(promptTitle(prompt('ExitPlanMode', {}))).toBe('Claude has a plan. Ready to start?');
    expect(promptTitle(prompt('mcp__github__create_issue', {}))).toBe('Allow create_issue?');
    expect(promptTitle(prompt('Bash', {}, 'Allow this command?'))).toBe('Allow this command?');
    expect(toolLabel('Bash')).toBe('Bash');
    expect(promptSubject(prompt('Bash', { command: 'rm -rf dist\nls', description: 'Clean' }))).toBe('rm -rf dist\nls');
    expect(promptSubject(prompt('Edit', { file_path: '/repo/a.ts' }))).toBe('/repo/a.ts');
  });

  it('answers questions with each one’s picks', () => {
    const asked = prompt('AskUserQuestion', { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }, { bad: true }] });
    expect(promptQuestions(asked).map((q) => q.question)).toEqual(['Which?']);
    expect(questionDecision(asked, { 'Which?': ['A', 'B'] })).toEqual({
      behavior: 'allow',
      updatedInput: { questions: (asked.input as { questions: unknown }).questions, answers: { 'Which?': 'A, B' } },
    });
  });
});
