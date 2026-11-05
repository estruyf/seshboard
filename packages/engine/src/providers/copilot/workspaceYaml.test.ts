import { describe, expect, it } from 'vitest';
import { parseWorkspaceYaml } from './workspaceYaml.ts';

describe('parseWorkspaceYaml', () => {
  it('reads plain, quoted and block values', () => {
    const yaml = [
      'id: f36d4086-77a2-4363-877d-11c1ac0d7814',
      'cwd: /Users/me/project',
      'name: Create test.json with dummy content',
      'summary: "Fix: the \\"quoted\\" bit — done"',
      "branch: 'it''s-main'",
      'summary_count: 0',
      'notes: |-',
      '  First line',
      '',
      '  Third line',
      'created_at: 2026-06-26T16:10:42.299Z',
      'empty:',
    ].join('\n');
    expect(parseWorkspaceYaml(yaml)).toEqual({
      id: 'f36d4086-77a2-4363-877d-11c1ac0d7814',
      cwd: '/Users/me/project',
      name: 'Create test.json with dummy content',
      summary: 'Fix: the "quoted" bit — done',
      branch: "it's-main",
      summary_count: '0',
      notes: 'First line\n\nThird line',
      created_at: '2026-06-26T16:10:42.299Z',
    });
  });

  it('folds > blocks and skips what it does not know', () => {
    const yaml = ['summary: >-', '  one', '  two', 'list:', '  - a', 'cwd: C:\\Users\\me'].join('\r\n');
    expect(parseWorkspaceYaml(yaml)).toEqual({ summary: 'one two', cwd: 'C:\\Users\\me' });
  });
});
