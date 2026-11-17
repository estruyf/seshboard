import { blanksOf, PROMPT_NAME_MAX } from '@seshboard/protocol/client';
import { describe, expect, it } from 'vitest';
import { pendingStarters, STARTER_PROMPTS } from './starterPrompts.ts';

describe('starter prompts', () => {
  it('fit a saved prompt and have unique ids and names', () => {
    expect(new Set(STARTER_PROMPTS.map((s) => s.id)).size).toBe(STARTER_PROMPTS.length);
    expect(new Set(STARTER_PROMPTS.map((s) => s.name)).size).toBe(STARTER_PROMPTS.length);
    for (const s of STARTER_PROMPTS) expect(s.name.length).toBeLessThanOrEqual(PROMPT_NAME_MAX);
  });

  it('asks for the feature in the throwaway build only', () => {
    const build = STARTER_PROMPTS.find((s) => s.id === 'throwaway-build')!;
    expect(blanksOf(build.text).map((b) => [b.name, b.type])).toEqual([['feature', 'text']]);
    expect(blanksOf(STARTER_PROMPTS.find((s) => s.id === 'best-judgment')!.text)).toEqual([]);
  });

  it('offers all of them when nothing is saved', () => {
    expect(pendingStarters([])).toEqual(STARTER_PROMPTS);
  });

  it('hides one that is saved, however it is padded', () => {
    const saved = [{ text: `  ${STARTER_PROMPTS[0]!.text}\n` }, { text: 'Something else' }];
    expect(pendingStarters(saved).map((s) => s.id)).toEqual(['throwaway-build']);
  });

  it('shows one again when its saved copy was edited', () => {
    expect(pendingStarters([{ text: `${STARTER_PROMPTS[0]!.text} Also tests.` }])).toEqual(STARTER_PROMPTS);
  });

  it('offers nothing once both are saved', () => {
    expect(pendingStarters(STARTER_PROMPTS)).toEqual([]);
  });
});
