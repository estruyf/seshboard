import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normaliseMessage, type RawSessionMessage } from '../../claude/transcript.ts';
import { codexFirstPrompt, codexMessages, codexSubagentThread, diffEdits, shellCommand } from './codexEvents.ts';
import type { Turn } from './protocol.ts';

/** A made-up thread in the shapes `thread/turns/list` returns (codex-cli 0.167, `itemsView: 'full'`). */
const TURNS = JSON.parse(readFileSync(new URL('./fixtures/turns.json', import.meta.url), 'utf8')) as Turn[];
const [T1, T2, T3] = TURNS.map((t) => t.id);

const blocksOf = (messages: RawSessionMessage[]) => messages.map((m) => ({ role: m.type, uuid: m.uuid, blocks: normaliseMessage(m).blocks }));
const byUuid = (uuid: string) => blocksOf(codexMessages(TURNS)).find((m) => m.uuid === uuid);
const toolUse = (id: string) =>
  codexMessages(TURNS)
    .flatMap((m) => normaliseMessage(m).blocks)
    .find((b) => b.type === 'tool_use' && b.id === id);
const toolResult = (id: string) =>
  codexMessages(TURNS)
    .flatMap((m) => normaliseMessage(m).blocks)
    .find((b) => b.type === 'tool_result' && b.toolUseId === id);

describe('codexMessages', () => {
  it('turns prompts, reasoning and replies into transcript messages, leaving out what Codex injects', () => {
    expect(byUuid(`${T1}:item-1`)).toEqual({ role: 'user', uuid: `${T1}:item-1`, blocks: [{ type: 'text', text: 'Add logging to the worker\n\n[Image: /repo/screenshot.png]' }] });
    expect(byUuid(`${T1}:rs_01`)!.blocks).toEqual([{ type: 'thinking', text: '**Looking at the worker**' }]);
    expect(byUuid(`${T1}:item-2`)).toEqual({ role: 'assistant', uuid: `${T1}:item-2`, blocks: [{ type: 'text', text: 'Done. I added a logger to the worker.' }] });
  });

  it('gives every message a unique id that stays the same on the next read', () => {
    const uuids = codexMessages(TURNS).map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(codexMessages(TURNS)).toEqual(codexMessages(TURNS));
  });

  it('dates items by their own times, else by their turn', () => {
    const messages = codexMessages(TURNS);
    expect(messages.find((m) => m.uuid === `${T1}:item-1`)!.timestamp).toBe(new Date(1778592901000).toISOString());
    expect(messages.find((m) => m.uuid === `${T1}:call_read`)!.timestamp).toBe(new Date(1778592903000).toISOString());
    expect(messages.find((m) => m.uuid === `${T1}:call_read:result`)!.timestamp).toBe(new Date(1778592903040).toISOString());
    expect(messages.find((m) => m.uuid === `${T2}:item-1`)!.timestamp).toBe(new Date(1778593000 * 1000).toISOString());
  });

  it('shows a command that reads one file as a Read of it, and others as Bash without the shell around them', () => {
    expect(toolUse(`${T1}:call_read`)).toMatchObject({ name: 'Read', input: { file_path: '/repo/src/Worker.cs' } });
    expect(toolResult(`${T1}:call_read`)).toMatchObject({ isError: false, text: 'using System;\nclass Worker {}\n' });
    expect(toolUse(`${T1}:call_test`)).toMatchObject({ name: 'Bash', input: { command: "dotnet test --filter 'Worker'" } });
    // A non-zero exit code is a failure, as Claude Code's Bash shows one.
    expect(toolResult(`${T1}:call_test`)).toMatchObject({ isError: true, text: 'Failed: 1\n' });
  });

  it('shows file changes as Edit (MultiEdit for several hunks), Write and Delete cards, in one message', () => {
    const call = byUuid(`${T1}:call_patch`)!;
    expect(call.role).toBe('assistant');
    expect(call.blocks).toEqual([
      {
        type: 'tool_use',
        id: `${T1}:call_patch:0`,
        name: 'MultiEdit',
        input: {
          file_path: '/repo/src/Worker.cs',
          edits: [
            { old_string: 'using System;\nclass Worker {}', new_string: 'using System;\nusing Microsoft.Extensions.Logging;\nclass Worker {}' },
            { old_string: '    Run();', new_string: '    Run(logger);' },
          ],
        },
        truncated: false,
      },
      { type: 'tool_use', id: `${T1}:call_patch:1`, name: 'Write', input: { file_path: '/repo/src/Log.cs', content: 'static class Log {}\n' }, truncated: false },
      { type: 'tool_use', id: `${T1}:call_patch:2`, name: 'Delete', input: { file_path: '/repo/src/Old.cs' }, truncated: false },
    ]);
    expect(byUuid(`${T1}:call_patch:result`)!.blocks.map((b) => b.type === 'tool_result' && [b.toolUseId, b.text])).toEqual([
      [`${T1}:call_patch:0`, 'Updated /repo/src/Worker.cs'],
      [`${T1}:call_patch:1`, 'Created /repo/src/Log.cs'],
      [`${T1}:call_patch:2`, 'Deleted /repo/src/Old.cs'],
    ]);
    // One change keeps the item's id; a declined one is an error.
    expect(toolUse(`${T1}:call_rename`)).toMatchObject({ name: 'Edit', input: { file_path: '/repo/src/Program.cs', old_string: 'using Foo;\n', new_string: 'using Foo;\nusing Bar;\n' } });
    expect(toolResult(`${T1}:call_rename`)).toMatchObject({ isError: true, text: 'Declined' });
  });

  it('shows web searches, pages, MCP tools and plans with their cards', () => {
    expect(toolUse(`${T1}:ws_01`)).toMatchObject({ name: 'WebSearch', input: { query: 'serilog worker service', queries: ['serilog worker service', 'dotnet worker logging'] } });
    expect(toolUse(`${T1}:ws_02`)).toMatchObject({ name: 'WebFetch', input: { url: 'https://example.com/logging' } });
    expect(toolUse(`${T1}:call_mcp`)).toMatchObject({ name: 'mcp__docs__search', input: { q: 'ILogger' } });
    expect(toolResult(`${T1}:call_mcp`)).toMatchObject({ isError: false, text: 'ILogger<T> is the generic logger.' });
    expect(toolUse(`${T1}:plan-1`)).toMatchObject({ name: 'ExitPlanMode', input: { plan: '1. Add the logger\n2. Run the tests' } });
    expect(toolResult(`${T1}:plan-1`)).toBeUndefined();
  });

  it('shows a spawned agent as an Agent card with what it reported, and finds its thread', () => {
    expect(toolUse(`${T2}:call_spawn`)).toMatchObject({ name: 'Agent', input: { prompt: 'Review the logging change', model: 'gpt-5.5' } });
    expect(toolResult(`${T2}:call_spawn`)).toMatchObject({ isError: false, text: 'Looks good.' });
    expect(toolUse(`${T2}:call_wait`)).toMatchObject({ name: 'wait', input: { agents: ['019a0000-0000-7000-8000-00000000bbbb'] } });
    expect(codexSubagentThread(TURNS, `${T2}:call_spawn`)).toBe('019a0000-0000-7000-8000-00000000bbbb');
    expect(codexSubagentThread(TURNS, `${T2}:call_wait`)).toBeNull();
    expect(codexSubagentThread(TURNS, 'nope')).toBeNull();
  });

  it('shows compactions, stopped and failed turns as notices, and unknown items as generic cards', () => {
    const turn2 = blocksOf(codexMessages(TURNS)).filter((m) => m.uuid.startsWith(T2!));
    expect(turn2.find((m) => m.uuid === `${T2}:cc-1`)).toEqual({ role: 'system', uuid: `${T2}:cc-1`, blocks: [{ type: 'unknown', kind: 'compact_boundary' }] });
    expect(turn2.some((m) => m.uuid === `${T2}:sa-1`)).toBe(false);
    expect(toolUse(`${T2}:sl-1`)).toMatchObject({ name: 'sleep', input: { durationMs: 5000 } });
    // Nothing to show: left out.
    expect(turn2.some((m) => m.uuid === `${T2}:x-1`)).toBe(false);
    expect(turn2.at(-1)).toEqual({ role: 'user', uuid: `${T2}#end`, blocks: [{ type: 'text', text: '[Request interrupted by user]' }] });
    const last = blocksOf(codexMessages(TURNS)).at(-1);
    expect(last).toEqual({ role: 'system', uuid: `${T3}#end`, blocks: [{ type: 'text', text: 'Codex stopped with an error: Rate limit reached' }] });
  });

  it('leaves a running tool without a result', () => {
    const turn = { id: 't', items: [{ type: 'commandExecution', id: 'c', command: 'ls', cwd: '/r', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null }], itemsView: 'full', status: 'inProgress', error: null, startedAt: 1, completedAt: null, durationMs: null } as Turn;
    expect(codexMessages([turn]).map((m) => m.type)).toEqual(['assistant']);
  });

  it('never throws on data it does not expect', () => {
    const odd = [
      { id: 'a', items: [null, 3, { type: 'userMessage', content: 'not a list' }, { type: 'fileChange', id: 'f', changes: [{ kind: null }], status: 'completed' }, { type: 'mcpToolCall', id: 'm', arguments: 'x', result: { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }, status: 'completed' }] },
      { items: 'nope' },
      null,
    ] as unknown as Turn[];
    expect(() => codexMessages(odd)).not.toThrow();
    expect(() => codexFirstPrompt(odd)).not.toThrow();
    const mcp = codexMessages(odd).flatMap((m) => normaliseMessage(m).blocks).find((b) => b.type === 'tool_result' && b.toolUseId === 'a:m');
    expect(mcp).toMatchObject({ type: 'tool_result', images: [{ mediaType: 'image/png' }] });
  });
});

describe('codexFirstPrompt', () => {
  it('is the first prompt without the context Codex injects', () => {
    expect(codexFirstPrompt(TURNS)).toBe('Add logging to the worker\n\n[Image: /repo/screenshot.png]');
    expect(codexFirstPrompt([])).toBeUndefined();
  });

  it('adds a mention or a skill only when the text does not have it', () => {
    const turn = (content: unknown[]) => [{ id: 't', items: [{ type: 'userMessage', id: 'u', content }] }] as unknown as Turn[];
    expect(codexFirstPrompt(turn([{ type: 'text', text: 'Use $lint here' }, { type: 'skill', name: 'lint', path: '/s/lint/SKILL.md' }]))).toBe('Use $lint here');
    expect(codexFirstPrompt(turn([{ type: 'text', text: 'Look at' }, { type: 'mention', name: 'a.ts', path: '/r/a.ts' }]))).toBe('Look at\n@/r/a.ts');
    expect(codexFirstPrompt(turn([{ type: 'text', text: '# AGENTS.md instructions for /r\n\n<INSTRUCTIONS>x</INSTRUCTIONS>' }]))).toBeUndefined();
  });
});

describe('shellCommand', () => {
  it('unwraps only a login shell running one quoted word', () => {
    expect(shellCommand("/bin/zsh -lc 'cat src/Worker.cs'")).toBe('cat src/Worker.cs');
    expect(shellCommand("/bin/bash -lc 'echo '\\''hi'\\'''")).toBe("echo 'hi'");
    expect(shellCommand('/bin/zsh -lc ls')).toBe('ls');
    expect(shellCommand("/bin/zsh -lc 'a' 'b'")).toBe("/bin/zsh -lc 'a' 'b'");
    expect(shellCommand('/bin/zsh -lc "echo $HOME"')).toBe('/bin/zsh -lc "echo $HOME"');
    expect(shellCommand('git status')).toBe('git status');
  });
});

describe('diffEdits', () => {
  it('turns hunks into before and after text, past headers and markers', () => {
    expect(diffEdits('--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n')).toEqual([{ old_string: 'a\nb', new_string: 'a\nc' }]);
    // An empty line in a hunk is a blank context line.
    expect(diffEdits('@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n')).toEqual([{ old_string: 'a\n\nb', new_string: 'a\n\nc' }]);
    expect(diffEdits('@@\n-x\n+y\n')).toEqual([{ old_string: 'x', new_string: 'y' }]);
    expect(diffEdits('')).toEqual([]);
  });
});
