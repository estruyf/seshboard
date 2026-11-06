import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { codexMessages } from './codexEvents.ts';
import { CodexLive, type CodexLiveEvents } from './codexLive.ts';
import type { ServerNotification, Turn } from './protocol.ts';

/** A made-up turn as `codex app-server` streams it (codex-cli 0.167 shapes), and the same turn read back with `thread/turns/list`. */
const LIVE = JSON.parse(readFileSync(new URL('./fixtures/liveTurn.json', import.meta.url), 'utf8')) as { threadId: string; notifications: ServerNotification[]; readBack: Turn };
const TURN = LIVE.readBack.id;

function record(threadId = LIVE.threadId, now = () => Date.parse('2026-05-12T16:00:00.000Z')) {
  const seen = {
    messages: [] as RawSessionMessage[],
    kept: [] as RawSessionMessage[],
    stream: [] as Array<{ kind: string; text: string }>,
    states: [] as Array<[string, string | undefined]>,
    usage: [] as unknown[],
    models: [] as string[],
    done: [] as string[],
  };
  const events: CodexLiveEvents = {
    stream: (delta) => seen.stream.push(delta),
    messages: (messages, options) => (options?.keep ? seen.kept : seen.messages).push(...messages),
    state: (state, error) => seen.states.push([state, error]),
    usage: (usage) => seen.usage.push(usage),
    model: (model) => seen.models.push(model),
    permissionDone: (requestId) => seen.done.push(requestId),
  };
  return { live: new CodexLive(threadId, events, now), seen };
}

describe('CodexLive', () => {
  it('streams a turn into the same messages the thread reads back', () => {
    const { live, seen } = record();
    for (const notification of LIVE.notifications) live.handle(notification);
    expect(seen.messages).toEqual(codexMessages([LIVE.readBack]));
    // The tool the stopped turn left running ends as the reader ends it.
    expect(seen.messages.at(-2)).toMatchObject({ uuid: `${TURN}:call_test:result`, message: { content: [{ tool_use_id: `${TURN}:call_test`, is_error: true, content: 'Interrupted' }] } });
    expect(seen.messages.at(-1)).toMatchObject({ uuid: `${TURN}#end` });
  });

  it('reports your prompt as soon as its item starts', () => {
    const { live, seen } = record();
    live.handle(LIVE.notifications[0]!);
    live.handle(LIVE.notifications[1]!);
    expect(seen.messages.map((m) => m.uuid)).toEqual([`${TURN}:item-1`]);
    live.handle(LIVE.notifications[2]!);
    expect(seen.messages).toHaveLength(1);
  });

  it('streams replies, thinking and running tools, and clears them when the message comes', () => {
    const { live, seen } = record();
    for (const notification of LIVE.notifications) live.handle(notification);
    expect(seen.stream).toEqual([
      { kind: 'thinking', text: '**Checking the routes**' },
      { kind: 'thinking', text: '\n\n' },
      // Raw reasoning is left out once its summary streams.
      { kind: 'thinking', text: 'Then the tests' },
      { kind: 'clear', text: '' },
      { kind: 'tool', text: 'Bash' },
      { kind: 'clear', text: '' },
      { kind: 'tool', text: 'Edit' },
      { kind: 'clear', text: '' },
      { kind: 'text', text: 'Added ' },
      { kind: 'text', text: 'GET /health.' },
      { kind: 'clear', text: '' },
      { kind: 'tool', text: 'Bash' },
      { kind: 'clear', text: '' },
    ]);
  });

  it('reports the turn, the context, the model and answered requests, and ignores other threads', () => {
    const { live, seen } = record();
    for (const notification of LIVE.notifications) live.handle(notification);
    expect(seen.states).toEqual([
      ['running', undefined],
      ['idle', undefined],
    ]);
    expect(seen.usage).toEqual([{ contextTokens: 31000, contextMax: 258400 }]);
    expect(seen.models).toEqual(['gpt-5.5-mini']);
    expect(seen.done).toEqual(['7']);
    expect(seen.messages.some((m) => m.uuid.includes('elsewhere'))).toBe(false);
    expect(live.item('elsewhere')).toBeNull();
  });

  it('keeps the latest of each item for the permission card', () => {
    const { live } = record();
    const upTo = LIVE.notifications.findIndex((n) => n.method === 'item/fileChange/patchUpdated');
    for (const notification of LIVE.notifications.slice(0, upTo)) live.handle(notification);
    expect(live.item('call_patch')).toMatchObject({ type: 'fileChange', changes: [] });
    live.handle(LIVE.notifications[upTo]!);
    expect(live.item('call_patch')).toMatchObject({ type: 'fileChange', changes: [{ path: '/repo/src/routes.ts' }] });
    live.handle(LIVE.notifications[upTo + 1]!);
    expect(live.item('call_patch')).toBeNull();
  });

  it('fails a turn with its error, else with the last one Codex gave up on', () => {
    const { live, seen } = record();
    const t = (status: string, error: unknown) => ({ id: 't1', items: [], itemsView: 'notLoaded', status, error, startedAt: 1, completedAt: 2, durationMs: 1000 });
    live.handle({ method: 'turn/started', params: { threadId: LIVE.threadId, turn: t('inProgress', null) } });
    live.handle({ method: 'error', params: { threadId: LIVE.threadId, turnId: 't1', willRetry: true, error: { message: 'Reconnecting' } } });
    live.handle({ method: 'error', params: { threadId: LIVE.threadId, turnId: 't1', willRetry: false, error: { message: 'Usage limit reached' } } });
    live.handle({ method: 'turn/completed', params: { threadId: LIVE.threadId, turn: t('failed', null) } });
    expect(seen.states.at(-1)).toEqual(['error', 'Usage limit reached']);
    live.handle({ method: 'turn/completed', params: { threadId: LIVE.threadId, turn: t('failed', { message: 'Bad request' }) } });
    expect(seen.states.at(-1)).toEqual(['error', 'Bad request']);
    expect(seen.messages.at(-1)).toMatchObject({ type: 'system', message: { content: [{ text: 'Codex stopped with an error: Bad request' }] } });
  });

  it('keeps plan steps as a to-do list and warnings as notes, which Codex does not', () => {
    const { live, seen } = record();
    live.handle({ method: 'turn/plan/updated', params: { threadId: LIVE.threadId, turnId: 't1', explanation: null, plan: [{ step: 'Add the route', status: 'completed' }, { step: 'Run the tests', status: 'inProgress' }, { step: 'Ship', status: 'pending' }] } });
    live.handle({ method: 'warning', params: { threadId: LIVE.threadId, message: 'Model metadata not found' } });
    live.handle({ method: 'warning', params: { threadId: null, message: 'For every thread' } });
    expect(seen.messages).toEqual([]);
    expect(seen.kept.map((m) => [m.type, m.timestamp])).toEqual([
      ['assistant', '2026-05-12T16:00:00.000Z'],
      ['user', '2026-05-12T16:00:00.000Z'],
      ['system', '2026-05-12T16:00:00.000Z'],
    ]);
    expect(seen.kept[0]!.message).toMatchObject({
      content: [
        {
          type: 'tool_use',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Add the route', status: 'completed' },
              { content: 'Run the tests', status: 'in_progress' },
              { content: 'Ship', status: 'pending' },
            ],
          },
        },
      ],
    });
    expect(new Set(seen.kept.map((m) => m.uuid)).size).toBe(3);
  });

  it('never throws on data it does not expect', () => {
    const { live } = record();
    const odd = [null, 3, {}, { method: 'item/completed' }, { method: 'item/completed', params: { threadId: LIVE.threadId, turnId: 't', item: null } }, { method: 'turn/completed', params: { threadId: LIVE.threadId, turn: 'x' } }, { method: 'thread/tokenUsage/updated', params: { threadId: LIVE.threadId, tokenUsage: { last: null } } }];
    for (const notification of odd) expect(() => live.handle(notification as unknown as ServerNotification)).not.toThrow();
  });
});
