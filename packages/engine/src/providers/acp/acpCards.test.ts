import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acpMentions, acpOutcome, acpPrompt, acpToolCard } from './acpCards.ts';

describe('acpToolCard', () => {
  it("shows a call as Claude Code's tool by its kind", () => {
    expect(acpToolCard({ toolCallId: 'a', kind: 'execute', title: 'npm test' })).toEqual({ toolName: 'Bash', input: { command: 'npm test' } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'edit', content: [{ type: 'diff', path: '/r/a.ts', oldText: 'x', newText: 'y' }] })).toEqual({ toolName: 'Edit', input: { file_path: '/r/a.ts', old_string: 'x', new_string: 'y' } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'edit', content: [{ type: 'diff', path: '/r/new.ts', oldText: null, newText: 'y', _meta: { kind: 'add' } }] })).toEqual({ toolName: 'Write', input: { file_path: '/r/new.ts', content: 'y' } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'read', title: 'a.ts', locations: [{ path: '/r/a.ts' }] })).toEqual({ toolName: 'Read', input: { file_path: '/r/a.ts' } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'search', title: "'total' in src" })).toEqual({ toolName: 'Grep', input: { pattern: "'total' in src" } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'fetch', title: 'Fetch https://example.com/x' })).toEqual({ toolName: 'WebFetch', input: { url: 'https://example.com/x' } });
  });

  it('keeps the name the agent gave another tool, with its title, or the input it sent', () => {
    expect(acpToolCard({ toolCallId: 'a', kind: 'other', title: 'Plan the work' }, 'write_todos')).toEqual({ toolName: 'write_todos', input: { description: 'Plan the work' } });
    expect(acpToolCard({ toolCallId: 'a', kind: 'think', rawInput: { q: 1 } })).toEqual({ toolName: 'think', input: { q: 1 } });
  });
});

describe('acpOutcome', () => {
  const options = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'once', kind: 'allow_once' },
    { optionId: 'no', kind: 'reject_once' },
  ];
  it('picks the option the agent offered for the answer', () => {
    expect(acpOutcome({ behavior: 'allow' }, options)).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });
    expect(acpOutcome({ behavior: 'allow', always: true }, options)).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } });
    expect(acpOutcome({ behavior: 'deny' }, options)).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(acpOutcome({ behavior: 'allow', always: true }, [{ optionId: 'once', kind: 'allow_once' }])).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });
    expect(acpOutcome({ behavior: 'deny' }, [])).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('prompts', () => {
  it('sends the files a line of mentions names as resource links, and pasted images', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'seshboard-acp-input-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'a.ts'), '');
    writeFileSync(join(cwd, 'my file.md'), '');
    const text = 'Fix it\n\n@src/a.ts#L1-4 @"my file.md" @src/ @gone.ts';
    expect(acpMentions(text, cwd)).toEqual([
      { type: 'resource_link', uri: `file://${join(cwd, 'src', 'a.ts')}`, name: 'src/a.ts#L1-4' },
      { type: 'resource_link', uri: `file://${join(cwd, 'my file.md')}`, name: 'my file.md' },
      { type: 'resource_link', uri: `file://${join(cwd, 'src')}`, name: 'src/' },
    ]);
    // An `@` in what you typed stays words.
    expect(acpMentions('Ask @alice about src/a.ts', cwd)).toEqual([]);
    expect(acpPrompt('Look', [{ type: 'image', mediaType: 'image/png', data: 'AAA' }], cwd)).toEqual([
      { type: 'text', text: 'Look' },
      { type: 'image', mimeType: 'image/png', data: 'AAA' },
    ]);
  });
});
