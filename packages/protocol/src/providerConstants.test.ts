import { describe, expect, it } from 'vitest';
import { claudeOnlyLine, notWithYet, switchLosses, switchNotice, type SwitchChoices } from './providerConstants.ts';

const nothing: SwitchChoices = { worktree: false, branch: null, pipeline: null, later: false, schedule: false };

describe('switching to another provider', () => {
  it('turns off only what was on and the provider has no support for', () => {
    expect(switchLosses({ ...nothing, worktree: true }, 'copilot', [])).toEqual(['worktree']);
    expect(switchLosses({ ...nothing, worktree: true, pipeline: 'review' }, 'copilot', [])).toEqual(['worktree', 'pipeline']);
    expect(switchLosses({ ...nothing, worktree: true }, 'copilot', ['worktree'])).toEqual([]);
    expect(switchLosses(nothing, 'copilot', [])).toEqual([]);
  });

  it('never turns anything off for Claude Code', () => {
    expect(switchLosses({ worktree: true, branch: 'main', pipeline: 'review', later: true, schedule: true }, 'claude', [])).toEqual([]);
  });

  it('says what was turned off, and why', () => {
    expect(switchNotice(['worktree'], 'copilot')).toBe("Worktree turned off. GitHub Copilot can't run in a worktree yet.");
    expect(switchNotice(['pipeline'], 'copilot')).toBe("Pipeline turned off. GitHub Copilot can't run pipelines yet.");
    expect(switchNotice(['worktree', 'pipeline'], 'copilot')).toBe("Worktree and pipeline turned off. GitHub Copilot can't run in a worktree and run pipelines yet.");
    expect(switchNotice([], 'copilot')).toBeNull();
  });

  it('names the provider on controls it has no support for yet', () => {
    expect(notWithYet('copilot')).toBe('Not with GitHub Copilot yet');
  });
});

describe("the ⋯ menu's Claude Code only line", () => {
  it('lists the session actions the provider has no support for, and shrinks as it gets them', () => {
    expect(claudeOnlyLine([])).toBe('Fork, Rewind, Rename and Ask about this session work with Claude Code only, for now.');
    expect(claudeOnlyLine(['fork', 'rewind'])).toBe('Rename and Ask about this session work with Claude Code only, for now.');
    expect(claudeOnlyLine(['fork', 'rewind', 'rename'])).toBe('Ask about this session works with Claude Code only, for now.');
    expect(claudeOnlyLine(['fork', 'rewind', 'rename', 'ask'])).toBeNull();
  });
});
