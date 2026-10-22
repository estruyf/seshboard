import { describe, expect, it } from 'vitest';
import type { RemoteBlock, RemoteMessage } from '@switchboard/protocol/remote-client';
import { runLabel, runSummary, stepText, transcriptItems } from './steps.ts';

let n = 0;
const msg = (role: RemoteMessage['role'], ...blocks: RemoteBlock[]): RemoteMessage => ({ uuid: `m${++n}`, role, timestamp: 1, parentToolUseId: null, blocks });
const call = (name: string, input: Record<string, unknown> = {}): RemoteBlock => ({ type: 'tool_use', id: `t${++n}`, name, input: input as never, truncated: false });
const result = (): RemoteBlock => ({ type: 'tool_result', toolUseId: 'x', isError: false, text: '', truncated: false });
const text = (t: string): RemoteBlock => ({ type: 'text', text: t });
const thinking = (t: string): RemoteBlock => ({ type: 'thinking', text: t });

describe('transcriptItems', () => {
  it('folds tool calls in a row into one run, across messages and the results between them', () => {
    const items = transcriptItems([
      msg('user', text('Add limits')),
      msg('assistant', text('Looking first.')),
      msg('assistant', call('Grep')),
      msg('user', result()),
      msg('assistant', thinking('hmm'), call('Read', { file_path: 'a.ts' })),
      msg('user', result()),
      msg('assistant', call('Edit', { file_path: 'a.ts' })),
      msg('assistant', text('Done.')),
    ]);
    expect(items.map((i) => (i.kind === 'run' ? `run ${i.steps.map((s) => s.type).join(',')}` : i.kind))).toEqual(['message', 'text', 'run tool_use,thinking,tool_use,tool_use', 'text']);
  });

  it('keeps thinking that no call follows out of the run', () => {
    const items = transcriptItems([msg('assistant', call('Bash'), thinking('so'), text('Hi'))]);
    expect(items.map((i) => i.kind)).toEqual(['run', 'thinking', 'text']);
  });

  it('shows lines from Claude Code as notices, not as your messages', () => {
    const items = transcriptItems([msg('user', text('Wait for CI')), msg('system', text('Background command "Wait" failed with exit code 1')), msg('system')]);
    expect(items.map((i) => i.kind)).toEqual(['message', 'notice']);
    expect(items[1]).toMatchObject({ text: 'Background command "Wait" failed with exit code 1' });
  });

  it('leaves out subagents\' messages and empty text', () => {
    const sub: RemoteMessage = { ...msg('assistant', call('Bash')), parentToolUseId: 't1' };
    expect(transcriptItems([sub, msg('assistant', text('  '))])).toEqual([]);
  });
});

describe('runSummary', () => {
  it('counts the steps and what they did', () => {
    const steps = [call('Edit', { file_path: 'a.ts' }), call('Edit', { file_path: 'a.ts' }), call('Write', { file_path: 'b.ts' }), call('MultiEdit', { file_path: 'c.ts' }), call('Bash'), call('Bash')] as never;
    expect(runSummary(steps)).toBe('6 steps · edited 3 files, ran 2 commands');
  });

  it('says it in the singular, and keeps to three kinds', () => {
    expect(runSummary([call('Bash'), thinking('x')] as never)).toBe('1 step · ran 1 command');
    expect(runSummary([call('Read', { file_path: 'a' }), call('Grep'), call('Glob'), call('WebFetch'), call('Edit', { file_path: 'b' })] as never)).toBe('5 steps · edited 1 file, read 1 file, searched 2 times');
    expect(runSummary([call('mcp__x__y')] as never)).toBe('1 step');
  });
});

describe('runLabel', () => {
  const merge = call('Bash', { command: "sed -i '' -e '/^<<<<<<< HEAD$/d' CHANGELOG.md && grep -c x", description: 'Merge origin/dev' });

  it('words a call the way the app does: its description, not its command', () => {
    expect(stepText(merge as never)).toBe('Merge origin/dev');
    expect(stepText(call('Bash', { command: 'npm test' }) as never)).toBe('Run npm test');
    expect(stepText(call('Bash', { command: "python3 - <<'EOF'\nprint(1)\nEOF" }) as never)).toBe('Run a Python script');
  });

  it('shows the step Claude is on, then what the steps did', () => {
    expect(runLabel([call('Read', { file_path: 'a.ts' }), merge] as never, true)).toBe('Merging origin/dev');
    expect(runLabel([merge, call('Bash', { command: 'ls' })] as never, false)).toBe('2 steps · ran 2 commands');
  });
});
