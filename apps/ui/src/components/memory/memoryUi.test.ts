import { describe, expect, it } from 'vitest';
import { canShare, copyableSections, filterByProfile, indexMeterText, memoryProfiles, parsePaths, removeByDefault, shareButtonLabel, shareNotices, typeTone, validRuleName } from './memoryUi.ts';

describe('share warnings in the dialog', () => {
  it('shows a secret first, as an error that needs a check, and notes after', () => {
    const notices = shareNotices(
      [
        { kind: 'targetDirty', detail: 'CLAUDE.md' },
        { kind: 'sameHeading', detail: 'Sidebar Order' },
        { kind: 'secrets', detail: 'a GitHub token' },
      ],
      'CLAUDE.md',
    );
    expect(notices.map((n) => [n.kind, n.tone, n.needsCheck, n.blocks])).toEqual([
      ['secrets', 'error', true, false],
      ['sameHeading', 'warn', false, false],
      ['targetDirty', 'info', false, false],
    ]);
    expect(notices[0]!.text).toContain('a GitHub token');
    expect(notices[1]!.text).toBe('CLAUDE.md has a section called “Sidebar Order” already.');
    expect(notices[2]!.text).toBe('Your addition goes on top of uncommitted changes in CLAUDE.md.');
  });

  it('lets Share go only when nothing blocks it and a secret was checked', () => {
    const secret = shareNotices([{ kind: 'secrets', detail: null }], 'CLAUDE.md');
    expect(canShare(secret, false)).toBe(false);
    expect(canShare(secret, true)).toBe(true);
    const there = shareNotices([{ kind: 'alreadyThere', detail: null }], 'CLAUDE.md');
    expect(there[0]!.text).toBe('This text is in CLAUDE.md already. There is nothing to add.');
    expect(canShare(there, true)).toBe(false);
    expect(canShare(shareNotices([{ kind: 'localNotIgnored', detail: null }], 'CLAUDE.local.md'), false)).toBe(true);
    expect(canShare([], false)).toBe(true);
  });
});

describe('share dialog labels', () => {
  it('names the file the primary button adds to', () => {
    expect(shareButtonLabel('/p', { kind: 'claude-md' }, '/p/CLAUDE.md')).toBe('Add to CLAUDE.md');
    expect(shareButtonLabel('/p', { kind: 'claude-md' }, '/p/.claude/CLAUDE.md')).toBe('Add to .claude/CLAUDE.md');
    expect(shareButtonLabel('/p', { kind: 'rule', file: 'ui.md' }, null)).toBe('Add to rules/ui.md');
    expect(shareButtonLabel('/p', { kind: 'local' }, null)).toBe('Add to CLAUDE.local.md');
  });

  it('removes from memory by default only for files the team gets', () => {
    expect(removeByDefault('claude-md')).toBe(true);
    expect(removeByDefault('rule')).toBe(true);
    expect(removeByDefault('local')).toBe(false);
  });

  it('checks rule names and splits the paths field', () => {
    expect(validRuleName('ui')).toBe(true);
    expect(validRuleName('frontend/ui.md')).toBe(true);
    expect(validRuleName('../x')).toBe(false);
    expect(validRuleName('has space')).toBe(false);
    expect(parsePaths(' apps/ui/**, , src/** ')).toEqual(['apps/ui/**', 'src/**']);
  });

  it('gives each memory type its own pill', () => {
    expect([typeTone('project'), typeTone('feedback'), typeTone('reference'), typeTone('user'), typeTone(null)]).toEqual(['default', 'caution', 'link', 'ok', 'muted']);
  });
});

describe('profiles', () => {
  it('offers a profile filter only for the profiles a project has memory in', () => {
    const memories = [{ profileId: 'work' }, { profileId: 'default' }, { profileId: 'work' }, { profileId: null }];
    expect(memoryProfiles(memories, ['default', 'work', 'other'])).toEqual(['default', 'work']);
    expect(memoryProfiles([{ profileId: 'default' }], ['default', 'work'])).toEqual(['default']);
    expect(filterByProfile(memories, 'work')).toHaveLength(2);
    expect(filterByProfile(memories, 'all')).toHaveLength(4);
  });
});

describe('copy to memory', () => {
  it('offers the ## and ### sections', () => {
    expect(copyableSections('# Top\n\n## A\n\n### B\n\n#### C\n').map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('says how full MEMORY.md gets', () => {
    expect(indexMeterText(65)).toEqual({ text: 'MEMORY.md becomes 65 of 200 lines', over: false });
    expect(indexMeterText(201).over).toBe(true);
  });
});
