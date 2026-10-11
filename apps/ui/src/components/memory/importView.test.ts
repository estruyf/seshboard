import { describe, expect, it } from 'vitest';
import type { ImportEntry, MemoryImportPreview } from '@switchboard/protocol/client';
import { copiedByDefault, flagsOf, personalLinesAfter, picked, rowsOf } from './importView.ts';

const entry = (id: string, extra: Partial<ImportEntry> = {}): ImportEntry => ({
  id,
  exportPath: id,
  fileName: `${id.slice(1)}`,
  name: id,
  description: '',
  type: 'user',
  target: 'personal',
  claudeProject: null,
  duplicateOf: null,
  secret: false,
  noProject: false,
  status: 'new',
  checked: true,
  excerpt: '',
  ...extra,
});
const preview = (entries: ImportEntry[]): MemoryImportPreview => ({ token: 't', entries, projects: [], personalIndexLines: 62 });

describe('import preview', () => {
  it('counts the lines the personal MEMORY.md gets: new memories going there, ticked', () => {
    const p = preview([entry('/a'), entry('/b', { status: 'newer' }), entry('/c', { target: '/p' }), entry('/d', { checked: false }), entry('/e', { target: 'skip' })]);
    const rows = rowsOf(p);
    expect(picked(rows).map((r) => r.entry.id)).toEqual(['/a', '/b', '/c']);
    expect(personalLinesAfter(p, rows)).toBe(63);
  });

  it('flags secrets first, then duplicates, a missing project and what was imported before', () => {
    expect(flagsOf(entry('/a', { secret: true, duplicateOf: 'cycling', noProject: true }), 'personal').map((f) => [f.label, f.tone])).toEqual([
      ['looks like a token', 'error'],
      ['duplicate of “cycling”', 'caution'],
      ['no matching project', 'muted'],
    ]);
    expect(flagsOf(entry('/a', { noProject: true }), '/p')).toEqual([]);
    expect(flagsOf(entry('/a', { status: 'same' }), 'personal').map((f) => f.label)).toEqual(['already imported']);
  });

  it('copies memories about you to the Claude app by default, not project notes', () => {
    expect([copiedByDefault({ type: 'user' }), copiedByDefault({ type: 'feedback' }), copiedByDefault({ type: 'project' }), copiedByDefault({ type: null })]).toEqual([true, true, false, false]);
  });
});
