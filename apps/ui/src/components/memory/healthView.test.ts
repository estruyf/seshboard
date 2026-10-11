import { describe, expect, it } from 'vitest';
import type { HealthFinding } from '@switchboard/protocol/client';
import { findingTone, flaggedPaths, healthSummary, mergedBody, tidyPrompt, toLookAt } from './healthView.ts';

const f = (kind: HealthFinding['kind'], memoryPaths: string[], detail: string = kind): HealthFinding => ({ kind, memoryPaths, detail });

describe('health in the UI', () => {
  it('counts what to look at without old memories', () => {
    const findings = [f('staleReference', ['/a.md']), f('old', ['/b.md']), f('duplicate', ['/a.md', '/c.md'])];
    expect(toLookAt(findings)).toHaveLength(2);
    expect(healthSummary(findings)).toBe('2 to look at');
    expect(healthSummary([f('old', ['/b.md'])])).toBe('nothing to look at');
  });

  it('flags the rows of memories with a finding, first detail wins', () => {
    const map = flaggedPaths([f('staleReference', ['/a.md'], 'stale'), f('duplicate', ['/a.md', '/c.md'], 'dup'), f('old', ['/b.md'])]);
    expect([...map]).toEqual([
      ['/a.md', 'stale'],
      ['/c.md', 'dup'],
    ]);
  });

  it('colours an index over the limit as an error and old as quiet', () => {
    expect([findingTone(f('overLimit', [])), findingTone(f('old', [])), findingTone(f('indexMismatch', []))]).toEqual(['error', 'faint', 'caution']);
  });

  it('writes the tidy prompt and merges without dropping text', () => {
    expect(tidyPrompt('~/m/MEMORY.md')).toContain("Tidy ~/m/MEMORY.md: merge duplicates and shorten lines so it fits in 200 lines; don't drop facts.");
    expect(mergedBody('Left.\n', '\nRight.')).toBe('Left.\n\n---\n\nRight.\n');
  });
});
