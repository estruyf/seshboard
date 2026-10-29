import { describe, expect, it } from 'vitest';
import { estimatePhrase, sanitizeAutoModel, tierOf, type AutoPick, type ModelOption } from '@seshboard/protocol/client';
import type { DisplayItem } from '../components/transcript/displayItems.ts';
import { autoChipModel, effectiveModel, estimateLine, failedLine, modelChoices, modelLabel, otherTiers, shortReason, toggleTier } from './autoModel.ts';
import { shouldSuggest, strongerTier, suggestReason, suggestSignals, type SuggestSignals } from './autoSuggest.ts';

const MODELS: ModelOption[] = [
  { value: 'default', displayName: 'Default', description: 'Your Claude Code default', supportsEffort: true },
  { value: 'opus', displayName: 'Opus', description: 'Most capable', supportsEffort: true },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast and capable', supportsEffort: true },
];
const PICK: AutoPick = { model: 'sonnet', reason: 'A small, local change: one setting and the code that reads it.', at: 1, tokens: 1_100, allowed: ['haiku', 'sonnet', 'opus'] };

describe('model menu', () => {
  it('puts Auto first, then a line, Default model and the models', () => {
    const choices = modelChoices(MODELS, { enabled: true, allowed: ['haiku', 'sonnet', 'opus'] });
    expect(choices.map((c) => c.value)).toEqual(['auto', '', 'opus', 'sonnet']);
    expect(choices[0]).toMatchObject({ label: 'Auto', separatorAfter: true, description: 'Haiku reads your prompt and picks Haiku, Sonnet or Opus. Picked once, when the session starts.' });
  });

  it('leaves Auto out when it is off, and a saved Auto falls back to the default model', () => {
    expect(modelChoices(MODELS, { enabled: false, allowed: ['opus'] }).map((c) => c.value)).toEqual(['', 'opus', 'sonnet']);
    expect(effectiveModel('auto', false)).toBe('');
    expect(effectiveModel('auto', true)).toBe('auto');
    expect(effectiveModel('opus', false)).toBe('opus');
    expect(modelLabel(MODELS, effectiveModel('auto', false))).toBe('Default model');
    expect(modelLabel(MODELS, 'auto')).toBe('Auto');
  });

  it('names only the allowed models', () => {
    expect(modelChoices(MODELS, { enabled: true, allowed: ['sonnet', 'haiku'] })[0]!.description).toContain('picks Haiku or Sonnet.');
  });
});

describe('the session chip', () => {
  it('reads Auto with the picked model until you change the model', () => {
    expect(autoChipModel(PICK)).toBe('Sonnet');
    expect(autoChipModel({ ...PICK, model: null })).toBe('Default model');
    expect(autoChipModel({ ...PICK, left: true })).toBeNull();
    expect(autoChipModel(null)).toBeNull();
  });
});

describe('first-turn line and popover', () => {
  it('shortens the reason to the part before a colon', () => {
    expect(shortReason(PICK.reason)).toBe('a small, local change');
    expect(shortReason('Planning across many files.')).toBe('planning across many files');
  });

  it('says why picking failed', () => {
    expect(failedLine("Haiku didn't answer in time")).toBe("Auto couldn't pick a model (haiku didn't answer in time), so this session uses your default model.");
  });

  it('estimates against Opus, as an estimate', () => {
    expect(estimateLine('haiku')).toBe('About a fifth of what Opus would use (est.)');
    expect(estimateLine('sonnet')).toBe('About three fifths of what Opus would use (est.)');
    expect(estimatePhrase(1)).toBe('The same as Opus');
  });

  it('offers the other allowed models, strongest first', () => {
    expect(otherTiers(PICK)).toEqual(['opus', 'haiku']);
    expect(otherTiers({ ...PICK, allowed: ['sonnet', 'opus'] })).toEqual(['opus']);
  });
});

describe('settings', () => {
  it('keeps at least one model, in order, and falls back to defaults', () => {
    expect(sanitizeAutoModel({ enabled: false, allowed: ['opus', 'haiku', 'gpt'], lean: 'cheaper', suggest: false })).toEqual({ enabled: false, allowed: ['haiku', 'opus'], lean: 'cheaper', suggest: false });
    expect(sanitizeAutoModel({ allowed: [] })).toEqual({ enabled: true, allowed: ['haiku', 'sonnet', 'opus'], lean: 'balanced', suggest: true });
    expect(sanitizeAutoModel('auto')).toBeNull();
    expect(tierOf('claude-opus-5-5')).toBe('opus');
  });

  it('never leaves Models it can pick empty', () => {
    expect(toggleTier(['haiku', 'sonnet'], 'opus', true)).toEqual(['haiku', 'sonnet', 'opus']);
    expect(toggleTier(['haiku', 'sonnet'], 'haiku', false)).toEqual(['sonnet']);
    expect(toggleTier(['sonnet'], 'sonnet', false)).toEqual(['sonnet']);
  });
});

const user = (text: string): DisplayItem => ({ kind: 'user', key: text, at: null, text, images: [], subagent: false });
const edit = (path: string, isError = false): DisplayItem => ({
  kind: 'tool',
  key: path + String(Math.random()),
  at: null,
  id: path,
  name: 'Edit',
  input: { file_path: path },
  inputTruncated: false,
  result: { text: '', isError, truncated: false, images: [], at: null },
  subagent: false,
});
const quiet: SuggestSignals = { prompt: 'Fix the typo', editedFiles: 1, userTurns: 2, failedInARow: 0 };

describe('suggesting a stronger model', () => {
  it('reads the signals from the transcript', () => {
    const items = [user('Fix it'), edit('/a.ts'), edit('/a.ts'), edit('/b.ts', true), edit('/c.ts', true), user('Now plan a refactor across all modules')];
    expect(suggestSignals(items)).toEqual({ prompt: 'Now plan a refactor across all modules', editedFiles: 3, userTurns: 2, failedInARow: 2 });
  });

  it('suggests when a later message asks for more, many files changed, the session ran long or tools keep failing', () => {
    expect(suggestReason(quiet)).toBeNull();
    expect(suggestReason({ ...quiet, prompt: 'Now refactor this across the whole codebase' })).toBe('ask');
    // The first message is what Auto read: it never counts.
    expect(suggestReason({ ...quiet, userTurns: 1, prompt: 'Refactor this across the whole codebase' })).toBeNull();
    expect(suggestReason({ ...quiet, editedFiles: 9 })).toBe('files');
    expect(suggestReason({ ...quiet, userTurns: 13 })).toBe('turns');
    expect(suggestReason({ ...quiet, failedInARow: 3 })).toBe('errors');
  });

  it('suggests the strongest allowed model above the pick, at most once, and never after you changed the model', () => {
    const grown = { ...quiet, editedFiles: 20 };
    expect(strongerTier(PICK)).toBe('opus');
    expect(strongerTier({ ...PICK, model: 'opus' })).toBeNull();
    expect(strongerTier({ ...PICK, allowed: ['haiku', 'sonnet'] })).toBeNull();
    expect(shouldSuggest({ enabled: true, pick: PICK, seen: false, signals: grown })).toBe('opus');
    expect(shouldSuggest({ enabled: true, pick: PICK, seen: true, signals: grown })).toBeNull();
    expect(shouldSuggest({ enabled: false, pick: PICK, seen: false, signals: grown })).toBeNull();
    expect(shouldSuggest({ enabled: true, pick: { ...PICK, left: true }, seen: false, signals: grown })).toBeNull();
    expect(shouldSuggest({ enabled: true, pick: PICK, seen: false, signals: quiet })).toBeNull();
    expect(shouldSuggest({ enabled: true, pick: null, seen: false, signals: grown })).toBeNull();
  });
});
