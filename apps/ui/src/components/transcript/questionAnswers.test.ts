import { describe, expect, it } from 'vitest';
import { answeredQuestions, parseAnswers, splitAnswer } from './questionAnswers.ts';

const question = (q: string, labels: string[], extra: Record<string, unknown> = {}) => ({ question: q, header: 'Pick', options: labels.map((label) => ({ label, description: 'about it' })), ...extra });

describe('parseAnswers', () => {
  it('reads each question\'s answer, in both wordings Claude Code has used', () => {
    const older = 'Your questions have been answered: "Which name?"="Both". You can now continue with these answers in mind.';
    expect([...parseAnswers(older, ['Which name?'])]).toEqual([['Which name?', 'Both']]);
    const newer = 'The user answered: "What should `x .` do?"="Open it, then start", "Which name?"="Both (Recommended)". Read the answers carefully and follow what they actually say.';
    expect([...parseAnswers(newer, ['What should `x .` do?', 'Which name?'])]).toEqual([
      ['What should `x .` do?', 'Open it, then start'],
      ['Which name?', 'Both (Recommended)'],
    ]);
  });

  it('keeps quotes inside an answer', () => {
    const text = 'The user answered: "Say what?"="She said "hi". Then left". Done.';
    expect(parseAnswers(text, ['Say what?']).get('Say what?')).toBe('She said "hi". Then left');
  });

  it('leaves out a question it cannot find', () => {
    expect(parseAnswers('Something else entirely', ['Which?']).size).toBe(0);
  });
});

describe('splitAnswer', () => {
  it('finds the option you picked', () => {
    expect(splitAnswer('Both (Recommended)', ['One', 'Both (Recommended)'])).toEqual({ picked: ['Both (Recommended)'], other: null });
  });

  it('finds several picks, and a label with a comma in it', () => {
    expect(splitAnswer('Red, green, Blue', ['Red, green', 'Blue', 'Red'])).toEqual({ picked: ['Red, green', 'Blue'], other: null });
  });

  it('keeps what you typed yourself, after your picks or on its own', () => {
    expect(splitAnswer('Blue, and a bit of teal', ['Blue', 'Red'])).toEqual({ picked: ['Blue'], other: 'and a bit of teal' });
    expect(splitAnswer('Neither, ask me later', ['Blue', 'Red'])).toEqual({ picked: [], other: 'Neither, ask me later' });
  });
});

describe('answeredQuestions', () => {
  const input = { questions: [question('Which?', ['A', 'B']), question('Also?', ['C', 'D'], { multiSelect: true })] };

  it('pairs each question with your answer', () => {
    const result = { text: 'The user answered: "Which?"="B", "Also?"="C, D". Read the answers carefully.', isError: false };
    expect(answeredQuestions({ name: 'AskUserQuestion', input, result })).toEqual([
      { question: 'Which?', header: 'Pick', multiSelect: false, options: ['A', 'B'], picked: ['B'], other: null },
      { question: 'Also?', header: 'Pick', multiSelect: true, options: ['C', 'D'], picked: ['C', 'D'], other: null },
    ]);
  });

  it('is null while waiting, when skipped, for other tools and when the answers can\'t be read', () => {
    expect(answeredQuestions({ name: 'AskUserQuestion', input, result: null })).toBeNull();
    expect(answeredQuestions({ name: 'AskUserQuestion', input, result: { text: 'The user declined this action.', isError: true } })).toBeNull();
    expect(answeredQuestions({ name: 'AskUserQuestion', input, result: { text: 'Answered in some new way', isError: false } })).toBeNull();
    expect(answeredQuestions({ name: 'Bash', input, result: { text: '"Which?"="B"', isError: false } })).toBeNull();
  });
});
