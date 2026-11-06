import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { codexMessages } from './codexEvents.ts';
import { CodexLive, codexCardId, type CodexLiveEvents } from './codexLive.ts';
import type { ServerNotification, Turn } from './protocol.ts';

/** A made-up turn as `codex app-server` streams it (codex-cli 0.167 shapes), and the same turn read back with `thread/turns/list`. */
const LIVE = JSON.parse(readFileSync(new URL('./fixtures/liveTurn.json', import.meta.url), 'utf8')) as { threadId: string; notifications: ServerNotification[]; readBack: Turn };
const TURN = LIVE.readBack.id;

function record(threadId = LIVE.threadId, requestId?: (codexId: string | number) => string) {
  const now = () => Date.parse('2026-05-12T16:00:00.000Z');
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
  return { live: new CodexLive(threadId, events, { now, ...(requestId ? { requestId } : {}) }), seen };
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

  it('reports items in the order they started, as the thread reads back, while the stream shows what runs', () => {
    const { live, seen } = record();
    const th = LIVE.threadId;
    const turn = { id: 'ov', items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: 1778600100, completedAt: null, durationMs: null };
    const cmd = (id: string, status: string, at: number) => ({ type: 'commandExecution', id, command: `/bin/zsh -lc 'sleep ${id}'`, cwd: '/repo', status, commandActions: [], aggregatedOutput: status === 'completed' ? id : null, exitCode: status === 'completed' ? 0 : null, durationMs: null, startedAtMs: at, completedAtMs: status === 'completed' ? at + 500 : null });
    const prompt = { type: 'userMessage', id: 'u1', clientId: null, content: [{ type: 'text', text: 'Run both', text_elements: [] }], startedAtMs: null, completedAtMs: 1778600100500 };
    const steer = { type: 'userMessage', id: 'u2', clientId: null, content: [{ type: 'text', text: 'Also add a test', text_elements: [] }], startedAtMs: null, completedAtMs: 1778600103000 };
    const n = (method: string, params: object) => ({ method, params: { threadId: th, turnId: 'ov', ...params } });
    const stream: ServerNotification[] = [
      n('turn/started', { turn }),
      n('item/started', { item: prompt, startedAtMs: 1778600100500 }),
      n('item/started', { item: cmd('a', 'inProgress', 1778600101000), startedAtMs: 1778600101000 }),
      n('item/started', { item: cmd('b', 'inProgress', 1778600102000), startedAtMs: 1778600102000 }),
      n('item/started', { item: steer, startedAtMs: 1778600103000 }),
      n('item/completed', { item: steer, completedAtMs: 1778600103000 }),
      n('item/completed', { item: cmd('b', 'completed', 1778600102000), completedAtMs: 1778600102500 }),
    ];
    for (const notification of stream) live.handle(notification);
    // Nothing after your prompt goes before `a`, which started first and still runs; the stream shows both tools.
    expect(seen.messages.map((m) => m.uuid)).toEqual(['ov:u1']);
    expect(seen.stream.filter((d) => d.kind === 'tool')).toEqual([
      { kind: 'tool', text: 'Bash' },
      { kind: 'tool', text: 'Bash' },
    ]);
    live.handle(n('item/completed', { item: cmd('a', 'completed', 1778600101000), completedAtMs: 1778600101500 }));
    expect(seen.messages.map((m) => m.uuid)).toEqual(['ov:u1', 'ov:a', 'ov:a:result', 'ov:b', 'ov:b:result', 'ov:u2']);
    const done = { ...turn, status: 'completed', completedAt: 1778600104 };
    live.handle({ method: 'turn/completed', params: { threadId: th, turn: done } });
    expect(seen.messages).toEqual(codexMessages([{ ...done, itemsView: 'full', items: [prompt, cmd('a', 'completed', 1778600101000), cmd('b', 'completed', 1778600102000), steer] } as unknown as Turn]));
  });

  it('adds an agent\'s report to its spawn as the thread read back does', () => {
    const { live, seen } = record();
    const th = LIVE.threadId;
    const turn = { id: 'ag', items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: 1778600200, completedAt: null, durationMs: null };
    const call = (id: string, tool: string, state: object) => ({ type: 'collabAgentToolCall', id, tool, status: 'completed', senderThreadId: th, receiverThreadIds: ['sub'], prompt: tool === 'spawnAgent' ? 'Review it' : null, model: null, reasoningEffort: null, agentsStates: { sub: state }, startedAtMs: 1778600201000, completedAtMs: 1778600202000 });
    const items = [call('spawn', 'spawnAgent', { status: 'pendingInit', message: null }), call('wait', 'wait', { status: 'completed', message: 'All good.' })];
    live.handle({ method: 'turn/started', params: { threadId: th, turn } });
    for (const item of items) {
      live.handle({ method: 'item/started', params: { threadId: th, turnId: 'ag', item, startedAtMs: 1778600201000 } });
      live.handle({ method: 'item/completed', params: { threadId: th, turnId: 'ag', item, completedAtMs: 1778600202000 } });
    }
    const done = { ...turn, status: 'completed', completedAt: 1778600203 };
    live.handle({ method: 'turn/completed', params: { threadId: th, turn: done } });
    expect(seen.messages).toEqual(codexMessages([{ ...done, itemsView: 'full', items } as unknown as Turn]));
    expect(seen.messages.at(-1)).toMatchObject({ uuid: 'ag:wait:report:sub', message: { content: [{ tool_use_id: 'ag:spawn', content: 'All good.' }] } });
  });

  it('gives notes new ids in every session run, so a note after a restart is kept too', () => {
    const first = record();
    const second = record();
    const warning = { method: 'warning', params: { threadId: LIVE.threadId, message: 'Model metadata not found' } };
    first.live.handle(warning);
    second.live.handle(warning);
    expect(first.seen.kept[0]!.uuid).not.toBe(second.seen.kept[0]!.uuid);
  });

  it('streams raw reasoning again in a later turn', () => {
    const { live, seen } = record();
    const p = (method: string, params: object) => ({ method, params: { threadId: LIVE.threadId, turnId: 't', itemId: 'rs', ...params } });
    live.handle(p('item/reasoning/summaryTextDelta', { delta: 'Summary', summaryIndex: 0 }));
    live.handle({ method: 'turn/completed', params: { threadId: LIVE.threadId, turn: { id: 't', status: 'completed', items: [], error: null, startedAt: 1, completedAt: 2 } } });
    live.handle(p('item/reasoning/textDelta', { delta: 'Raw', contentIndex: 0 }));
    expect(seen.stream.at(-1)).toEqual({ kind: 'thinking', text: 'Raw' });
  });

  it('takes a card away by the id the driver gave it', () => {
    const { live, seen } = record(LIVE.threadId, (id) => codexCardId(LIVE.threadId, id));
    live.handle({ method: 'serverRequest/resolved', params: { threadId: LIVE.threadId, requestId: 0 } });
    expect(seen.done).toEqual([`${LIVE.threadId}:0`]);
  });

  it('puts a turn\'s prompt first when its item comes late', () => {
    const { live, seen } = record();
    const th = LIVE.threadId;
    const turn = { id: 'late', items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: 1778600300, completedAt: null, durationMs: null };
    const reasoning = { type: 'reasoning', id: 'rs', summary: ['Thinking'], content: [], startedAtMs: 1778600301000, completedAtMs: null };
    const prompt = { type: 'userMessage', id: 'u', clientId: null, content: [{ type: 'text', text: 'Go', text_elements: [] }], startedAtMs: null, completedAtMs: 1778600302000 };
    const n = (method: string, params: object) => ({ method, params: { threadId: th, turnId: 'late', ...params } });
    for (const notification of [n('turn/started', { turn }), n('item/started', { item: reasoning, startedAtMs: 1778600301000 }), n('item/started', { item: prompt, startedAtMs: 1778600302000 })]) live.handle(notification);
    expect(seen.messages.map((m) => m.uuid)).toEqual(['late:u']);
    live.handle(n('item/completed', { item: { ...reasoning, completedAtMs: 1778600303000 }, completedAtMs: 1778600303000 }));
    expect(seen.messages.map((m) => m.uuid)).toEqual(['late:u', 'late:rs']);
  });

  it('never throws on data it does not expect', () => {
    const { live } = record();
    const odd = [null, 3, {}, { method: 'item/completed' }, { method: 'item/completed', params: { threadId: LIVE.threadId, turnId: 't', item: null } }, { method: 'turn/completed', params: { threadId: LIVE.threadId, turn: 'x' } }, { method: 'thread/tokenUsage/updated', params: { threadId: LIVE.threadId, tokenUsage: { last: null } } }];
    for (const notification of odd) expect(() => live.handle(notification as unknown as ServerNotification)).not.toThrow();
  });
});
