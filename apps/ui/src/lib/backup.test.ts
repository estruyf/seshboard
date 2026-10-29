import { describe, expect, it } from 'vitest';
import type { ImportChange } from '@seshboard/protocol/client';
import { DEFAULT_EXPORT_SECTIONS, groupChanges, hasEffect, summarizeChanges } from './backup.ts';

const change = (section: ImportChange['section'], change: ImportChange['change'], label: string = section): ImportChange => ({ section, label, change, detail: null });

describe('backup helpers', () => {
  it('leaves sessions out of an export by default', () => {
    expect(DEFAULT_EXPORT_SECTIONS).toEqual(['preferences', 'themes', 'profiles', 'projects', 'actions', 'schedules', 'triggers', 'pipelines', 'choices']);
  });

  it('groups changes by section with adds first', () => {
    const groups = groupChanges([change('actions', 'skip', 'a'), change('projects', 'keep'), change('actions', 'add', 'b'), change('projects', 'add')]);
    expect(groups.map((g) => [g.section, g.changes.map((c) => `${c.change}:${c.label}`)])).toEqual([
      ['projects', ['add:projects', 'keep:projects']],
      ['actions', ['add:b', 'skip:a']],
    ]);
  });

  it('summarizes what an import would do', () => {
    expect(summarizeChanges([change('projects', 'add'), change('projects', 'add'), change('actions', 'skip')], 4)).toBe('2 to add, 1 skipped, 4 unchanged');
    expect(summarizeChanges([], 0)).toBe('Nothing to import');
    expect(hasEffect([change('projects', 'keep'), change('actions', 'skip')])).toBe(false);
    expect(hasEffect([change('projects', 'remove')])).toBe(true);
  });
});
