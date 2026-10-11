import { describe, expect, it } from 'vitest';
import type { LoadEntry } from '@switchboard/protocol/client';
import { barSegments, indexLevel, legendItems, loadSummary } from './loadOrderView.ts';

const e = (path: string, kind: LoadEntry['kind'], bytes: number, extra: Partial<LoadEntry> = {}): LoadEntry => ({ path, kind, scope: 'project', when: 'launch', bytes, lines: 10, ...extra });
const entries: LoadEntry[] = [
  e('/h/.claude/CLAUDE.md', 'user', 2150),
  e('/p/CLAUDE.md', 'project', 1434),
  e('/p/.claude/rules/a.md', 'rule', 500),
  e('/p/.claude/rules/b.md', 'rule', 420),
  e('/m/MEMORY.md', 'memory', 3000, { lines: 214, loaded: { lines: 200, bytes: 2800 } }),
  e('/p/.claude/rules/ui.md', 'rule', 600, { when: 'on-demand', paths: ['apps/ui/**'] }),
];
const label = (path: string) => path.replace(/^\/p\//, '');

describe('what loads here', () => {
  it('colours MEMORY.md by its lines: caution from 180, high past 200', () => {
    expect([indexLevel(10), indexLevel(179), indexLevel(180), indexLevel(200), indexLevel(201)]).toEqual(['ok', 'ok', 'caution', 'caution', 'high']);
  });

  it('sums up what loads at launch in one line', () => {
    expect(loadSummary(entries)).toBe('Loads 5 files · 7.1 KB · MEMORY.md 214/200');
    expect(loadSummary([])).toBe('Loads 0 files · 0 B');
  });

  it('splits MEMORY.md into what loads and what doesn’t, and leaves on-demand rules out of the bar', () => {
    expect(barSegments(entries).map((s) => [s.kind, s.bytes, s.overflow])).toEqual([
      ['user', 2150, false],
      ['project', 1434, false],
      ['rule', 500, false],
      ['rule', 420, false],
      ['memory', 2800, false],
      ['memory', 200, true],
    ]);
  });

  it('groups rules side by side and says how much of MEMORY.md loads', () => {
    expect(legendItems(entries, label).map((i) => [i.label, i.detail, i.paths.length])).toEqual([
      ['/h/.claude/CLAUDE.md', '2.1 KB', 1],
      ['CLAUDE.md', '1.4 KB', 1],
      ['2 rules', '0.9 KB', 2],
      ['MEMORY.md', '200 of 214 lines', 1],
      ['14 lines not loaded', '', 1],
      ['.claude/rules/ui.md', 'on demand: apps/ui/**', 1],
    ]);
  });
});
