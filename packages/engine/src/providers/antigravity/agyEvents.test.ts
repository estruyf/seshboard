import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { agyMessages, agyReplayInfo, agyToolCard, commandOutput } from './agyEvents.ts';
import { AgyLive } from './agyLive.ts';

/** Recorded with agy 1.5.12 (paths and names made up): a turn's replay, a steered and a stopped prompt, and its permission requests. */
const FIXTURES = JSON.parse(readFileSync(new URL('./fixtures/acpReplay.json', import.meta.url), 'utf8')) as { replay: unknown[]; steer: unknown[]; permissions: Array<{ toolCall: never }> };

const blocks = (m: RawSessionMessage) => (m.message as { content: Array<Record<string, unknown>> }).content;

describe('agyMessages', () => {
  it('reads a replayed turn as your prompt, thoughts, tool calls with their results and the reply', () => {
    const messages = agyMessages('s1', FIXTURES.replay, { prompts: [Date.parse('2026-11-19T16:26:23Z')], fallback: 0 });
    expect(messages.map((m) => [m.type, m.uuid, blocks(m)[0]!.type, blocks(m)[0]!.name ?? null])).toEqual([
      ['user', 's1~u1', 'text', null],
      ['assistant', 's1~u1~1', 'thinking', null],
      ['assistant', 's1~u1~2', 'tool_use', 'Read'],
      ['user', 's1~u1~2~result', 'tool_result', null],
      ['assistant', 's1~u1~3', 'tool_use', 'Bash'],
      ['user', 's1~u1~3~result', 'tool_result', null],
      ['assistant', 's1~u1~4', 'tool_use', 'Bash'],
      ['user', 's1~u1~4~result', 'tool_result', null],
      ['assistant', 's1~u1~5', 'tool_use', 'Edit'],
      ['user', 's1~u1~5~result', 'tool_result', null],
      ['assistant', 's1~u1~6', 'tool_use', 'Write'],
      ['user', 's1~u1~6~result', 'tool_result', null],
      ['assistant', 's1~u1~7', 'tool_use', 'Bash'],
      ['user', 's1~u1~7~result', 'tool_result', null],
      ['assistant', 's1~u1~8', 'thinking', null],
      ['assistant', 's1~u1~9', 'text', null],
    ]);
    expect(messages[0]!.timestamp).toBe('2026-11-19T16:26:23.000Z');
    // The command's output without Antigravity's header, the edit as the text it replaced.
    expect(blocks(messages[3 + 2]!)[0]!.content).toBe('./notes.txt:2:world\n');
    expect(blocks(messages[8]!)[0]!.input).toEqual({ file_path: '/work/notes-demo/notes.txt', old_string: 'world', new_string: 'there' });
    expect(blocks(messages[10]!)[0]!.input).toEqual({ file_path: '/work/notes-demo/todo.md', content: '- [ ] Complete tasks\n' });
  });

  it('counts every prompt, steered and stopped ones too, each joined with the files it linked', () => {
    const messages = agyMessages('s2', FIXTURES.steer);
    expect(messages.filter((m) => m.type === 'user' && blocks(m)[0]!.type === 'text').map((m) => [m.uuid, blocks(m)[0]!.text])).toEqual([
      ['s2~u1', 'Run the shell command: sleep 8 && echo one. Then reply with the word one.'],
      ['s2~u2', 'Also, end your reply with the word banana.'],
      ['s2~u3', 'Run the shell command: sleep 20 && echo two.'],
      ['s2~u4', '/compact'],
    ]);
    expect(agyReplayInfo(FIXTURES.steer)).toMatchObject({ title: 'Run Shell Command Sleep And Echo', prompts: 4 });
    const linked = agyMessages('s3', [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'What is in it?' } },
      { sessionUpdate: 'user_message_chunk', content: { type: 'resource_link', uri: 'file:///w/notes.txt', name: 'notes.txt' } },
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Next' } },
    ]);
    expect(linked.map((m) => blocks(m)[0]!.text)).toEqual(['What is in it?\n\n@notes.txt', 'Next']);
  });

  it('leaves a tool still running without a result, and degrades on what it does not know', () => {
    const messages = agyMessages('s4', [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Go' } },
      { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'browser_open', kind: 'other', title: 'Open a page', status: 'in_progress', args: { Url: 'http://localhost' } },
      { sessionUpdate: 'something_new', x: 1 },
      null,
    ]);
    expect(messages.map((m) => m.uuid)).toEqual(['s4~u1', 's4~u1~1']);
    expect(blocks(messages[1]!)[0]).toMatchObject({ name: 'browser_open', input: { Url: 'http://localhost' } });
  });
});

describe('agyToolCard', () => {
  it("shows Antigravity's tools as Claude Code's", () => {
    const [grep, , edit] = FIXTURES.permissions;
    expect(agyToolCard(grep!.toolCall)).toEqual({ toolName: 'Bash', input: { command: 'grep -rn "world" .', description: 'Search folder for word world' } });
    expect(agyToolCard(edit!.toolCall).toolName).toBe('Edit');
    expect(commandOutput('Created At: x\nCompleted At: y\nCommand exited with code 1.\n\nCommand output:\nboom\r\n')).toBe('boom\n');
  });
});

describe('AgyLive', () => {
  it('reports the same messages, with the same ids, as a read of the conversation later', () => {
    const live: RawSessionMessage[] = [];
    const streamed: string[] = [];
    let context = 0;
    const events = { stream: (d: { kind: string }) => streamed.push(d.kind), messages: (m: RawSessionMessage[]) => live.push(...m), usage: (u: { contextTokens?: number }) => (context = u.contextTokens ?? 0), model: () => {} };
    const handler = new AgyLive('s1', events as never, 0, () => 0);
    const replay = FIXTURES.replay as Array<{ sessionUpdate: string; content?: unknown }>;
    // Live, the prompt is yours; then the updates come as the replay has them, but tool calls in two steps.
    expect(handler.prompted([replay[0]!.content as never])).toBe(1);
    for (const update of replay.slice(1)) {
      if (update.sessionUpdate === 'tool_call') {
        handler.handle({ ...update, status: 'in_progress', rawOutput: undefined, content: undefined });
        handler.handle({ ...update, sessionUpdate: 'tool_call_update' });
      } else handler.handle(update);
    }
    // The reply may still grow: it waits for the turn's end.
    expect(live.at(-1)!.uuid).toBe('s1~u1~8');
    handler.turnEnded();
    expect(live.map((m) => m.uuid)).toEqual(agyMessages('s1', FIXTURES.replay).map((m) => m.uuid));
    expect(streamed).toContain('tool');
    expect(streamed.at(-1)).toBe('clear');
    expect(context).toBe(11212);
    // The next turn goes on from the prompts before it.
    expect(handler.prompted([{ type: 'text', text: 'Again' }])).toBe(2);
    expect(live.at(-1)!.uuid).toBe('s1~u2');
  });

  it('builds nothing from what comes before a prompt sent here', () => {
    const live: RawSessionMessage[] = [];
    const handler = new AgyLive('s1', { stream: () => {}, messages: (m: RawSessionMessage[]) => live.push(...m), usage: () => {}, model: () => {} } as never, 3);
    handler.handle({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } });
    handler.turnEnded();
    expect(live).toEqual([]);
    expect(handler.prompts()).toBe(3);
  });
});
