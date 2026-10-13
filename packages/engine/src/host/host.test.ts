import type { Options, PermissionResult, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ModelOption, PermissionRequest, QueuedMessage, SessionHostInfo, StreamDelta } from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { HostManager, type SdkRuntime } from './hostManager.ts';
import { describeSuggestions } from './permissions.ts';
import { buildOptions, type HostConfig } from './sessionHost.ts';
import { createMemorySessionSettings, type SessionSettingsStore } from './sessionSettings.ts';
import { summarise, type StoredUpNext } from './upNextStore.ts';

/** Minimal async channel that can also fail, like a Claude Code process dying. */
class Channel<T> implements AsyncIterable<T> {
  private items: Array<{ value: T } | { error: Error }> = [];
  private wake: (() => void) | undefined;
  private done = false;
  push(value: T) {
    this.items.push({ value });
    this.wake?.();
  }
  fail(error: Error) {
    this.items.push({ error });
    this.wake?.();
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) {
        const item = this.items.shift()!;
        if ('error' in item) throw item.error;
        yield item.value;
      }
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const SUGGESTION = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] as const;

/** Scripted stand-in for a Claude Code process. Prompts starting with `bash:` ask for permission; `crash` kills it. */
class FakeQuery {
  readonly out = new Channel<unknown>();
  interrupts = 0;
  /** What reached Claude Code, in order. */
  received: Array<{ text: string; priority?: string }> = [];
  stoppedTasks: string[] = [];
  closed = false;
  /** The host ended its input (it lets go of the process once it has stopped). */
  inputEnded = false;
  mode: string;
  model = 'fake-model';
  constructor(
    readonly prompt: AsyncIterable<SDKUserMessage>,
    readonly options: Options,
  ) {
    this.mode = options.permissionMode ?? 'default';
    void this.run();
  }
  [Symbol.asyncIterator]() {
    return this.out[Symbol.asyncIterator]();
  }
  private async run() {
    // Claude Code takes the id we pass for new sessions and forks; a resume keeps the resumed id.
    const sessionId = (this.options.sessionId ?? this.options.resume)!;
    const state = (s: string) => this.out.push({ type: 'system', subtype: 'session_state_changed', state: s, session_id: sessionId });
    const assistant = (text: string) =>
      this.out.push({ type: 'assistant', uuid: `a-${text}`, parent_tool_use_id: null, session_id: sessionId, message: { model: 'fake', content: [{ type: 'text', text }] } });
    for await (const message of this.prompt) {
      const text = (message.message.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
      this.received.push({ text, ...(message.priority ? { priority: message.priority } : {}) });
      this.out.push({ type: 'system', subtype: 'init', session_id: sessionId, cwd: this.options.cwd, model: this.model, permissionMode: this.mode });
      state('running');
      if (text === 'crash') {
        this.out.fail(new Error('Claude Code process exited with code 1'));
        return;
      }
      if (text.startsWith('bash:')) {
        state('requires_action');
        const result = (await this.options.canUseTool!('Bash', { command: text.slice(5) }, {
          signal: new AbortController().signal,
          suggestions: [...SUGGESTION] as never,
          toolUseID: 'tool-1',
        } as never)) as PermissionResult;
        state('running');
        assistant(`${result.behavior}${'updatedPermissions' in result && result.updatedPermissions ? '+always' : ''}`);
      } else {
        if (text === 'skill') {
          // Claude Code answers the Skill tool, then adds the skill's instructions as a synthetic message.
          this.out.push({ type: 'user', uuid: 'u-launch', parent_tool_use_id: null, session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'skill-1', content: 'Launching skill: deploy' }] } });
          this.out.push({ type: 'user', uuid: 'u-skill-body', parent_tool_use_id: null, isSynthetic: true, session_id: sessionId, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /skills/deploy' }] } });
        }
        this.out.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', content_block: { type: 'text' } } });
        for (const chunk of ['Hel', 'lo']) {
          this.out.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } } });
        }
        assistant('Hello');
      }
      this.out.push({ type: 'result', subtype: text === 'fail' ? 'error_during_execution' : 'success', is_error: text === 'fail', total_cost_usd: 0.01, session_id: sessionId });
      state('idle');
    }
    this.inputEnded = true;
  }
  async interrupt() {
    this.interrupts++;
  }
  async stopTask(taskId: string) {
    this.stoppedTasks.push(taskId);
  }
  async setPermissionMode(mode: string) {
    this.mode = mode;
  }
  async setModel(model?: string) {
    this.model = model ?? 'default';
  }
  /** Skills written to disk after start, picked up by reloadSkills(). */
  newSkills: Array<{ name: string; description: string; argumentHint: string }> = [];
  private skills: Array<{ name: string; description: string; argumentHint: string }> = [];
  async supportedCommands() {
    return [
      { name: 'review', description: 'Review the diff', argumentHint: '' },
      { name: 'doctor', description: 'Terminal only', argumentHint: '' },
      { name: '__remote-workflow', description: 'Internal', argumentHint: '' },
      ...this.skills,
    ];
  }
  async reloadSkills() {
    this.skills = [...this.newSkills];
    return { skills: this.skills };
  }
  async supportedModels() {
    return [{ value: 'fake', displayName: 'Fake', description: 'Test model', supportsEffort: false }];
  }
  async getContextUsage() {
    return { percentage: 12.4 };
  }
  /** Side questions asked, with the history that came along. */
  sideQuestions: Array<{ question: string; history: unknown }> = [];
  async askSideQuestion(question: string, options?: { history?: unknown }) {
    this.sideQuestions.push({ question, history: options?.history ?? [] });
    return { response: `Side answer to ${question}`, synthetic: false };
  }
  close() {
    this.closed = true;
    this.out.end();
  }
}

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function setup(
  opts: { openElsewhere?: string[]; cwds?: Record<string, string>; profiles?: Record<string, string>; settings?: SessionSettingsStore; refreshLive?: () => void; upNext?: ReturnType<typeof memoryUpNext> } = {},
) {
  const upNextEvents: Array<{ sessionId: string; queue: QueuedMessage[] }> = [];
  const models: ModelOption[][] = [];
  const queries: FakeQuery[] = [];
  const infos: SessionHostInfo[] = [];
  const streams: StreamDelta[] = [];
  const messages: Array<{ id: string; messages: RawSessionMessage[] }> = [];
  const permissions: PermissionRequest[] = [];
  const resolved: string[] = [];
  const created: string[] = [];
  const warmups: Array<{ options: Options; closed: boolean }> = [];
  const ephemeral = new Set<string>();
  const sdk: SdkRuntime = {
    query: ({ prompt, options }) => {
      const q = new FakeQuery(prompt, options);
      queries.push(q);
      return q as never;
    },
    startup: async ({ options }) => {
      const warmup = { options, closed: false };
      warmups.push(warmup);
      return {
        query: (prompt: AsyncIterable<SDKUserMessage>) => {
          const q = new FakeQuery(prompt, options);
          queries.push(q);
          return q;
        },
        close: () => void (warmup.closed = true),
      } as never;
    },
  };
  const manager = new HostManager({
    sdk: async () => sdk,
    // Each profile's processes get its config folder.
    env: async (profileId) => ({ PATH: '/usr/bin', ...(profileId === 'default' ? {} : { CLAUDE_CONFIG_DIR: `/config/${profileId}` }) }),
    claudePath: async () => '/usr/local/bin/claude',
    isOpenElsewhere: (id) => (opts.openElsewhere ?? []).includes(id),
    sessionCwd: (id) => opts.cwds?.[id] ?? null,
    sessionProfile: (id) => opts.profiles?.[id] ?? 'default',
    refreshLive: opts.refreshLive,
    onInfo: (i) => infos.push(i),
    onStream: (d) => streams.push(d),
    onMessages: (id, m) => messages.push({ id, messages: m }),
    onPermission: (r) => permissions.push(r),
    onPermissionResolved: (id) => resolved.push(id),
    onCreated: (id) => created.push(id),
    sessionSettings: opts.settings,
    upNext: opts.upNext,
    onUpNext: (sessionId, queue) => upNextEvents.push({ sessionId, queue }),
    onModels: (m) => models.push(m),
    ephemeral,
    log: () => {},
  });
  return { manager, queries, infos, streams, messages, permissions, resolved, created, models, warmups, ephemeral, upNextEvents };
}

/** Up next kept in memory, as the engine keeps it in SQLite. */
function memoryUpNext(seed: Record<string, StoredUpNext[]> = {}) {
  const lists = new Map<string, StoredUpNext[]>(Object.entries(seed));
  return {
    lists,
    list: (sessionId: string) => [...(lists.get(sessionId) ?? [])],
    all: () => [...lists].map(([sessionId, queue]) => ({ sessionId, queue: queue.map(summarise) })),
    save: (sessionId: string, messages: readonly StoredUpNext[]) => void (messages.length ? lists.set(sessionId, [...messages]) : lists.delete(sessionId)),
  };
}

const base = { attachments: [], model: null, permissionMode: 'default' as const, effort: null, worktree: null, profileId: 'default' };
const lastState = (infos: SessionHostInfo[], id: string) => infos.filter((i) => i.sessionId === id).at(-1)?.state;

describe('HostManager', () => {
  it('creates a session, shows the prompt at once and streams the reply', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi' });
    expect(t.created).toEqual([id]);
    // The optimistic prompt is pushed before Claude Code answers.
    expect(t.messages[0]).toMatchObject({ id, messages: [{ type: 'user' }] });
    await until(() => lastState(t.infos, id) === 'idle' && t.infos.at(-1)!.contextPercent !== null);
    expect(t.queries[0]!.options).toMatchObject({ sessionId: id, cwd: '/work/app', includePartialMessages: true, enableFileCheckpointing: true });
    expect(t.streams.filter((s) => s.kind === 'text').map((s) => s.text).join('')).toBe('Hello');
    expect(t.messages.flatMap((m) => m.messages.map((x) => x.uuid))).toContain('a-Hello');
    expect(t.infos.at(-1)).toMatchObject({ model: 'fake-model', costUsd: 0.01, contextPercent: 12 });
    // The Working list orders by when you last sent a message.
    expect(t.infos.at(-1)!.promptedAt).toBeGreaterThanOrEqual(t.infos.at(-1)!.startedAt);
    await expect(t.manager.commands(id, undefined, 'default')).resolves.toEqual([{ name: 'review', description: 'Review the diff', argumentHint: '' }]);
    t.manager.closeAll();
  });

  it('keeps a loaded skill\'s instructions out of the conversation', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'skill' });
    await until(() => lastState(t.infos, id) === 'idle');
    const uuids = t.messages.flatMap((m) => m.messages.map((x) => x.uuid));
    expect(uuids).toContain('u-launch');
    expect(uuids).not.toContain('u-skill-body');
    t.manager.closeAll();
  });

  it('brokers permission prompts and applies "always allow"', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
    await until(() => t.permissions.length === 1);
    const request = t.permissions[0]!;
    expect(request).toMatchObject({ sessionId: id, toolName: 'Bash', toolUseId: 'tool-1', input: { command: 'npm test' } });
    expect(request.alwaysLabel).toBe('Allow Bash(npm test:*) in this project (just you)');
    expect(t.manager.list().permissions).toHaveLength(1);
    t.manager.respond(request.requestId, { behavior: 'allow', always: true });
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-allow+always')));
    expect(t.resolved).toEqual([request.requestId]);
    expect(() => t.manager.respond(request.requestId, { behavior: 'deny' })).toThrow(/already answered/);
    t.manager.closeAll();
  });

  it('denies pending prompts when interrupted', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:rm -rf build' });
    await until(() => t.permissions.length === 1);
    await t.manager.interrupt(id);
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-deny')));
    expect(t.queries[0]!.interrupts).toBe(1);
    t.manager.closeAll();
  });

  it('sends now by stopping the current turn: the message goes first and the waiting prompt is denied', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm run build' });
    await until(() => t.permissions.length === 1);
    const sent = await t.manager.send({ sessionId: id, text: 'Look at the tests instead', attachments: [], fork: false, mode: 'now' });
    expect(sent.queued).toBe(false);
    expect(t.queries[0]!.interrupts).toBe(1);
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-Hello')));
    expect(t.queries[0]!.received).toEqual([{ text: 'bash:npm run build' }, { text: 'Look at the tests instead' }]);
    const uuids = t.messages.flatMap((m) => m.messages.map((x) => x.uuid));
    expect(uuids.indexOf('a-deny')).toBeLessThan(uuids.indexOf('a-Hello'));
    t.manager.closeAll();
  });

  it('only stops Claude for a message sent now while it works', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
    await until(() => t.permissions.length === 1);
    // Queued: it waits for the turn instead of stopping it.
    await t.manager.send({ sessionId: id, text: 'Then the docs', attachments: [], fork: false });
    expect(t.queries[0]!.received).toEqual([{ text: 'bash:npm test' }]);
    t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-Hello')) && lastState(t.infos, id) === 'idle');
    expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['bash:npm test', 'Then the docs']);
    // Idle: there is nothing to stop, so now sends like any message.
    await t.manager.send({ sessionId: id, text: 'One more', attachments: [], fork: false, mode: 'now' });
    await until(() => t.queries[0]!.received.length === 3);
    expect(t.queries[0]!.received.at(-1)).toEqual({ text: 'One more' });
    t.manager.closeAll();
  });

  describe('the queue', () => {
    const busy = async (t: ReturnType<typeof setup>) => {
      const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
      await until(() => t.permissions.length === 1);
      return id;
    };
    const queue = (t: ReturnType<typeof setup>, id: string) => t.infos.filter((i) => i.sessionId === id).at(-1)!.queue;
    const send = (t: ReturnType<typeof setup>, id: string, text: string, mode?: 'queue' | 'steer' | 'now') =>
      t.manager.send({ sessionId: id, text, attachments: [], fork: false, mode });
    const inTranscript = (t: ReturnType<typeof setup>, text: string) =>
      t.messages.some((m) => m.messages.some((x) => JSON.stringify(x.message).includes(text)));

    it('holds messages sent while Claude works, out of the transcript, and sends one per turn', async () => {
      const t = setup();
      const id = await busy(t);
      const first = await send(t, id, 'Then the docs');
      await send(t, id, 'And the changelog');
      expect(first.queued).toBe(true);
      expect(queue(t, id).map((m) => m.text)).toEqual(['Then the docs', 'And the changelog']);
      expect(inTranscript(t, 'Then the docs')).toBe(false);
      expect(t.queries[0]!.received).toEqual([{ text: 'bash:npm test' }]);

      t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
      // The first one goes when the turn ends; the second waits for that turn to end too.
      await until(() => t.queries[0]!.received.length === 3);
      expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['bash:npm test', 'Then the docs', 'And the changelog']);
      const lengths = t.infos.filter((i) => i.sessionId === id).map((i) => i.queue.length);
      // One message leaves the queue per turn: 2, then 1, then 0.
      expect(lengths.lastIndexOf(2)).toBeLessThan(lengths.lastIndexOf(1));
      expect(lengths.lastIndexOf(1)).toBeLessThan(lengths.lastIndexOf(0));
      await until(() => queue(t, id).length === 0 && lastState(t.infos, id) === 'idle');
      expect(inTranscript(t, 'Then the docs')).toBe(true);
      t.manager.closeAll();
    });

    it('answers a side question beside a running turn, without touching the turn, the queue or the transcript', async () => {
      const t = setup();
      const id = await busy(t);
      await send(t, id, 'Then the docs');
      const infosBefore = t.infos.length;
      const messagesBefore = t.messages.length;

      const history = [{ question: 'Earlier?', response: 'Yes' }];
      await expect(t.manager.sideQuestion(id, 'Which flag?', history)).resolves.toEqual({ response: 'Side answer to Which flag?', synthetic: false });
      // Asked on the session's own process, with the earlier exchanges, never as a message.
      expect(t.queries).toHaveLength(1);
      expect(t.queries[0]!.sideQuestions).toEqual([{ question: 'Which flag?', history }]);
      expect(t.queries[0]!.received).toEqual([{ text: 'bash:npm test' }]);
      expect(t.queries[0]!.interrupts).toBe(0);
      // No status, queue or transcript change came from it.
      expect(t.infos.length).toBe(infosBefore);
      expect(t.messages.length).toBe(messagesBefore);
      expect(lastState(t.infos, id)).toBe('needs-you');
      expect(queue(t, id).map((m) => m.text)).toEqual(['Then the docs']);
      expect(inTranscript(t, 'Which flag?')).toBe(false);

      // The turn then goes on as before: its reply, then the queued message.
      t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
      await until(() => t.queries[0]!.received.length === 2);
      expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['bash:npm test', 'Then the docs']);
      expect(t.messages.flatMap((m) => m.messages.map((x) => x.uuid))).toContain('a-allow');
      t.manager.closeAll();
    });

    it('answers a side question for a session that is not running from a fork that writes nothing', async () => {
      const t = setup({ cwds: { 'old-1': '/work/app' }, openElsewhere: ['old-1'] });
      await expect(t.manager.sideQuestion('old-1', 'What changed?', [])).resolves.toMatchObject({ response: 'Side answer to What changed?' });
      // Not resumed: a short-lived copy, even with the session open in another window.
      expect(t.manager.has('old-1')).toBe(false);
      expect(t.queries).toHaveLength(1);
      expect(t.queries[0]!.options).toMatchObject({ resume: 'old-1', forkSession: true, persistSession: false, cwd: '/work/app' });
      expect(t.queries[0]!.options.sessionId).not.toBe('old-1');
      expect(t.queries[0]!.received).toEqual([]);
      expect(t.queries[0]!.closed).toBe(true);
      expect(t.ephemeral.has(t.queries[0]!.options.sessionId!)).toBe(true);
      t.manager.closeAll();
    });

    it('steers: Claude gets the message now, without a stop and without queueing it', async () => {
      const t = setup();
      const id = await busy(t);
      const sent = await send(t, id, 'Use tabs', 'steer');
      expect(sent.queued).toBe(false);
      expect(queue(t, id)).toEqual([]);
      expect(inTranscript(t, 'Use tabs')).toBe(true);
      expect(t.queries[0]!.interrupts).toBe(0);
      t.manager.closeAll();
    });

    it('sends one queued message now and leaves the others waiting', async () => {
      const t = setup();
      const id = await busy(t);
      await send(t, id, 'one');
      const { queueId } = { queueId: queue(t, id)[0]!.id };
      await send(t, id, 'two');
      const two = queue(t, id)[1]!.id;
      void queueId;
      await t.manager.sendQueuedNow(id, two);
      expect(queue(t, id).map((m) => m.text)).toEqual(['one']);
      expect(t.queries[0]!.interrupts).toBe(1);
      // 'one' still waits for the turn after that one.
      await until(() => t.queries[0]!.received.some((r) => r.text === 'one'));
      const order = t.queries[0]!.received.map((r) => r.text);
      expect(order.indexOf('two')).toBeLessThan(order.indexOf('one'));
      t.manager.closeAll();
    });

    it('takes a queued message back, with its images, and reorders the rest', async () => {
      const t = setup();
      const id = await busy(t);
      const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'shot.png' };
      await t.manager.send({ sessionId: id, text: 'one', attachments: [image], fork: false });
      await send(t, id, 'two');
      await send(t, id, 'three');
      expect(queue(t, id)[0]).toMatchObject({ text: 'one', attachments: ['shot.png'] });
      expect(JSON.stringify(queue(t, id))).not.toContain('AAAA');

      t.manager.moveQueued(id, queue(t, id)[2]!.id, 0);
      expect(queue(t, id).map((m) => m.text)).toEqual(['three', 'one', 'two']);
      expect(t.manager.dequeue(id, queue(t, id)[1]!.id)).toEqual({ text: 'one', attachments: [image] });
      expect(queue(t, id).map((m) => m.text)).toEqual(['three', 'two']);
      expect(t.manager.dequeue(id, 'gone')).toBeNull();
      t.manager.closeAll();
    });

    it('keeps the queue when you stop Claude, until you send it', async () => {
      const t = setup();
      const id = await busy(t);
      await send(t, id, 'later');
      await t.manager.interrupt(id);
      await until(() => lastState(t.infos, id) === 'idle');
      expect(t.infos.filter((i) => i.sessionId === id).at(-1)!.queueHold).toBe('stopped');
      expect(queue(t, id)).toHaveLength(1);
      expect(t.queries[0]!.received).toEqual([{ text: 'bash:npm test' }]);

      t.manager.resumeQueue(id);
      await until(() => t.queries[0]!.received.some((r) => r.text === 'later'));
      expect(t.infos.filter((i) => i.sessionId === id).at(-1)!.queueHold).toBeNull();
      t.manager.closeAll();
    });

    it('keeps the queue when a turn fails, and a message you send yourself ends the hold', async () => {
      const t = setup();
      const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:go' });
      await until(() => t.permissions.length === 1);
      // The fake fails the turn that gets 'fail', so queue it behind a turn that is still going.
      await send(t, id, 'fail');
      await send(t, id, 'after');
      t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
      await until(() => t.queries[0]!.received.some((r) => r.text === 'fail') && lastState(t.infos, id) === 'idle' && t.infos.at(-1)!.queueHold === 'error');
      expect(queue(t, id).map((m) => m.text)).toEqual(['after']);
      expect(t.queries[0]!.received.some((r) => r.text === 'after')).toBe(false);

      await send(t, id, 'my own');
      await until(() => t.queries[0]!.received.some((r) => r.text === 'after'));
      expect(t.queries[0]!.received.map((r) => r.text).slice(-2)).toEqual(['my own', 'after']);
      t.manager.closeAll();
    });

    it('keeps Up next with its images on every change, so it outlives the process', async () => {
      const store = memoryUpNext();
      const t = setup({ upNext: store });
      const id = await busy(t);
      const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'shot.png' };
      await t.manager.send({ sessionId: id, text: 'later', attachments: [image], fork: false });
      expect(store.list(id)).toMatchObject([{ text: 'later', attachments: [image] }]);
      expect(t.upNextEvents.at(-1)).toMatchObject({ sessionId: id, queue: [{ text: 'later', attachments: ['shot.png'] }] });
      expect(t.manager.upNextLists()).toMatchObject([{ sessionId: id, queue: [{ text: 'later' }] }]);
      t.manager.close(id);
      expect(store.list(id)).toHaveLength(1);
      t.manager.closeAll();
    });

    const kept = (id: string, text: string): StoredUpNext => ({ id, text, attachments: [], createdAt: 1 });

    it('after a restart, a resumed session gets Up next back, waiting until you send', async () => {
      const store = memoryUpNext({ old: [kept('k1', 'kept')] });
      const t = setup({ cwds: { old: '/w' }, upNext: store });
      await send(t, 'old', 'my own');
      // Back, and on hold: it doesn't go before your own message.
      expect(t.infos.find((i) => i.sessionId === 'old')).toMatchObject({ queue: [{ text: 'kept' }], queueHold: 'saved' });
      // Your message ends the hold: the kept one goes when its turn is done.
      await until(() => t.queries[0]!.received.length === 2);
      expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['my own', 'kept']);
      await until(() => store.list('old').length === 0);
      t.manager.closeAll();
    });

    it('Send next resumes a stopped session and sends Up next, one message per turn', async () => {
      const store = memoryUpNext({ old: [kept('k1', 'first'), kept('k2', 'second')] });
      const t = setup({ cwds: { old: '/w' }, upNext: store });
      await t.manager.resumeQueue('old');
      await until(() => t.queries[0]?.received.length === 2);
      expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['first', 'second']);
      t.manager.closeAll();
    });

    it('edits a stopped session’s Up next without starting it, and Send now on one resumes it', async () => {
      const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'shot.png' };
      const store = memoryUpNext({ old: [kept('a', 'a'), kept('b', 'b'), { ...kept('c', 'c'), attachments: [image] }] });
      const t = setup({ cwds: { old: '/w' }, upNext: store });
      t.manager.moveQueued('old', 'b', 0);
      expect(store.list('old').map((m) => m.id)).toEqual(['b', 'a', 'c']);
      expect(t.manager.dequeue('old', 'c')).toEqual({ text: 'c', attachments: [image] });
      expect(store.list('old').map((m) => m.id)).toEqual(['b', 'a']);
      expect(t.upNextEvents.at(-1)).toMatchObject({ sessionId: 'old', queue: [{ id: 'b' }, { id: 'a' }] });
      expect(t.queries).toHaveLength(0);

      await t.manager.sendQueuedNow('old', 'a');
      await until(() => t.queries[0]?.received.length === 2);
      expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['a', 'b']);
      t.manager.closeAll();
    });

    it('sends at once when Claude is idle', async () => {
      const t = setup();
      const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hi' });
      await until(() => lastState(t.infos, id) === 'idle');
      const sent = await send(t, id, 'next');
      expect(sent.queued).toBe(false);
      expect(queue(t, id)).toEqual([]);
      t.manager.closeAll();
    });
  });

  it('refuses to resume a session open elsewhere, but can fork it', async () => {
    const t = setup({ openElsewhere: ['busy'], cwds: { busy: '/repo' } });
    await expect(t.manager.send({ sessionId: 'busy', text: 'hi', attachments: [], fork: false })).rejects.toMatchObject({ code: 'SESSION_BUSY_ELSEWHERE' });
    const forked = await t.manager.send({ sessionId: 'busy', text: 'hi', attachments: [], fork: true });
    expect(forked.sessionId).not.toBe('busy');
    // The fork gets its own id up front (Claude Code takes --session-id together with --fork-session).
    expect(t.queries[0]!.options).toMatchObject({ resume: 'busy', forkSession: true, sessionId: forked.sessionId, cwd: '/repo' });
    expect(t.created).toEqual([forked.sessionId]);
    expect(t.manager.has(forked.sessionId)).toBe(true);
    // Nothing about the fork is ever reported under the original's id.
    expect(t.infos.filter((i) => i.sessionId === 'busy')).toEqual([]);
    expect(t.messages.every((m) => m.id === forked.sessionId)).toBe(true);
    expect(t.manager.list().hosts.map((h) => h.sessionId)).toEqual([forked.sessionId]);
    t.manager.closeAll();
  });

  it('shows a sent slash command the way the transcript stores it', async () => {
    const t = setup({ cwds: { old: '/repo' } });
    await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => lastState(t.infos, 'old') === 'idle');
    expect((await t.manager.commands('old', undefined, 'default')).map((c) => c.name)).toEqual(['review']);
    const echoed = async (text: string) => {
      const { messageUuid } = await t.manager.send({ sessionId: 'old', text, attachments: [], fork: false });
      const message = t.messages.flatMap((m) => m.messages).find((m) => m.uuid === messageUuid)!;
      return (message.message as { content: { text: string }[] }).content[0]!.text;
    };
    expect(await echoed('/review the diff\nslowly')).toBe('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the diff\nslowly</command-args>');
    expect(await echoed('/tmp is full')).toBe('/tmp is full');
    t.manager.closeAll();
  });

  it('forks a session running here without touching the running one', async () => {
    const t = setup({ cwds: { old: '/repo' } });
    await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => lastState(t.infos, 'old') === 'idle');
    const before = t.infos.filter((i) => i.sessionId === 'old').length;
    const forked = await t.manager.send({ sessionId: 'old', text: 'try another way', attachments: [], fork: true });
    await until(() => lastState(t.infos, forked.sessionId) === 'idle');
    expect(t.infos.filter((i) => i.sessionId === 'old')).toHaveLength(before);
    // The fork's prompt goes into the fork's transcript, not the original's.
    expect(t.messages.filter((m) => m.messages[0]!.uuid === forked.messageUuid).map((m) => m.id)).toEqual([forked.sessionId]);
    // Both stay in the map, so the original can still be stopped.
    expect(t.manager.has('old')).toBe(true);
    expect(t.manager.has(forked.sessionId)).toBe(true);
    t.manager.close('old');
    await until(() => t.queries[0]!.closed);
    expect(t.queries[1]!.closed).toBe(false);
    t.manager.closeAll();
  });

  it('starts one process when two messages arrive for a stopped session at once', async () => {
    const t = setup({ cwds: { old: '/repo' } });
    const [a, b] = await Promise.all([
      t.manager.send({ sessionId: 'old', text: 'first', attachments: [], fork: false }),
      t.manager.send({ sessionId: 'old', text: 'second', attachments: [], fork: false }),
    ]);
    expect(t.queries).toHaveLength(1);
    expect([a.sessionId, b.sessionId]).toEqual(['old', 'old']);
    await until(() => t.messages.filter((m) => m.messages[0]!.uuid === 'a-Hello').length === 2);
    t.manager.closeAll();
  });

  it('resumes in the folder the session ran in', async () => {
    const t = setup({ cwds: { old: '/projects/site' } });
    await t.manager.send({ sessionId: 'old', text: 'continue', attachments: [], fork: false });
    expect(t.queries[0]!.options).toMatchObject({ resume: 'old', cwd: '/projects/site' });
    await expect(t.manager.send({ sessionId: 'unknown', text: 'x', attachments: [], fork: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    t.manager.closeAll();
  });

  it('isolates a crashing Claude Code process to its own session', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'crash' });
    await until(() => lastState(t.infos, id) === 'error');
    expect(t.infos.at(-1)!.error).toMatch(/exited with code 1/);
    await expect(t.manager.interrupt(id)).rejects.toMatchObject({ code: 'NOT_RUNNING' });
    // A second session still works.
    const other = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, other) === 'idle');
    t.manager.closeAll();
  });

  it('adopts a pre-warmed process for a new session in the same folder', async () => {
    const t = setup();
    await t.manager.prewarm('/work/app', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi', permissionMode: 'plan' });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.mode).toBe('plan');
    t.manager.closeAll();
  });

  it('keeps a pre-warmed process out of the session list until a session adopts it', async () => {
    const t = setup();
    await t.manager.prewarm('/work/app', 'default');
    const warmId = t.warmups[0]!.options.sessionId!;
    expect(t.ephemeral.has(warmId)).toBe(true);
    await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi' });
    expect(t.ephemeral.has(warmId)).toBe(false);
    // A discarded one stays hidden while its process exits.
    await t.manager.prewarm('/work/other', 'default');
    t.manager.closeAll();
    expect(t.ephemeral.has(t.warmups[1]!.options.sessionId!)).toBe(true);
  });

  it('keeps one pre-warmed process when pre-warms overlap, and none after a shutdown', async () => {
    const t = setup();
    await Promise.all([t.manager.prewarm('/a', 'default'), t.manager.prewarm('/b', 'default'), t.manager.prewarm('/b', 'default')]);
    expect(t.warmups.map((w) => w.options.cwd)).toEqual(['/b']);
    const late = t.manager.prewarm('/c', 'default');
    t.manager.closeAll();
    await late;
    await until(() => t.warmups[0]!.closed);
    expect(t.warmups).toHaveLength(1);
  });

  it('waits for its own exiting process after a natural exit, even when an older stop is on record', async () => {
    const open: string[] = [];
    const t = setup({ cwds: { old: '/w' }, openElsewhere: open, refreshLive: () => void open.splice(0) });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
      await until(() => lastState(t.infos, 'old') === 'idle');
      t.manager.close('old');
      // Twenty seconds later it is resumed, and then its process exits on its own.
      clock.mockReturnValue(now + 20_000);
      await t.manager.send({ sessionId: 'old', text: 'again', attachments: [], fork: false });
      await until(() => lastState(t.infos, 'old') === 'idle');
      t.queries[1]!.out.end();
      await until(() => lastState(t.infos, 'old') === 'closed');
      // Its registry entry lingers for a moment: that's our own process leaving, not another window.
      open.push('old');
      await t.manager.send({ sessionId: 'old', text: 'once more', attachments: [], fork: false });
      expect(t.queries).toHaveLength(3);
    } finally {
      clock.mockRestore();
      t.manager.closeAll();
    }
  });

  it('ends a closed session\'s input so the SDK can let go of it', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.manager.close(id);
    await until(() => t.queries[0]!.inputEnded);
    // A process that exits on its own is let go of too.
    const other = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, other) === 'idle');
    t.queries[1]!.out.end();
    await until(() => t.queries[1]!.inputEnded && t.queries[1]!.closed);
    t.manager.closeAll();
  });

  it('holds the first message until setup has finished', async () => {
    const t = setup();
    let finishSetup!: () => void;
    const setupDone = new Promise<void>((resolve) => (finishSetup = resolve));
    const seen: string[] = [];
    const id = await t.manager.create({
      ...base,
      cwd: '/w',
      prompt: 'hello',
      beforeFirstMessage: async (sessionId) => {
        seen.push(sessionId);
        await setupDone;
      },
    });
    expect(seen).toEqual([id]);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.messages).toEqual([]);
    finishSetup();
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.messages[0]).toMatchObject({ id, messages: [{ type: 'user' }] });
    t.manager.closeAll();
  });

  it('opens a session on Auto at once, shows your message, and sends it on the model Auto picks', async () => {
    const t = setup();
    let answer!: (pick: { model: string | null; autoPick: { model: 'sonnet'; reason: string; at: number; tokens: number; allowed: Array<'sonnet'> } }) => void;
    const picked = new Promise<Parameters<typeof answer>[0]>((resolve) => (answer = resolve));
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello', pickModel: () => picked });
    // Your message shows, and the session says Auto is choosing; Claude Code hasn't got it yet.
    expect(t.messages[0]).toMatchObject({ id, messages: [{ type: 'user' }] });
    expect(t.infos.at(-1)).toMatchObject({ sessionId: id, autoChoosing: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(lastState(t.infos, id)).toBe('starting');
    const autoPick = { model: 'sonnet' as const, reason: 'A small change.', at: 1, tokens: 900, allowed: ['sonnet' as const] };
    answer({ model: 'sonnet', autoPick });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries[0]!.options.model).toBeUndefined();
    expect(t.infos.at(-1)).toMatchObject({ model: 'sonnet', autoPick });
    expect(t.infos.at(-1)!.autoChoosing).toBeUndefined();
    t.manager.closeAll();
  });

  it('keeps the model you pick while Auto is still choosing', async () => {
    const t = setup();
    let answer!: () => void;
    const id = await t.manager.create({
      ...base,
      cwd: '/w',
      prompt: 'hello',
      pickModel: () => new Promise((resolve) => (answer = () => resolve({ model: 'haiku', autoPick: { model: 'haiku', reason: 'Tiny.', at: 1, tokens: 1, allowed: ['haiku'] } }))),
    });
    await t.manager.setModel(id, 'opus');
    answer();
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.infos.at(-1)).toMatchObject({ model: 'opus', autoPick: null });
    t.manager.closeAll();
  });

  it('reports that the session left Auto when you change the model after the pick', async () => {
    const t = setup();
    const autoPick = { model: 'sonnet' as const, reason: 'A small change.', at: 1, tokens: 900, allowed: ['sonnet' as const] };
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello', pickModel: async () => ({ model: 'sonnet', autoPick }) });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.infos.at(-1)).toMatchObject({ model: 'sonnet', autoPick });
    await t.manager.setModel(id, 'opus');
    expect(t.infos.at(-1)).toMatchObject({ model: 'opus', autoPick: { ...autoPick, left: true } });
    t.manager.closeAll();
  });

  it('lists commands for a folder without starting a session, once', async () => {
    const t = setup();
    const first = await t.manager.commands(undefined, '/projects/web', 'default');
    expect(first.map((c) => c.name)).toEqual(['review']);
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.closed).toBe(true);
    await t.manager.commands(undefined, '/projects/web', 'default');
    expect(t.queries).toHaveLength(1);
    // Another profile has its own user commands, skills and plugins.
    await t.manager.commands(undefined, '/projects/web', 'work');
    expect(t.queries).toHaveLength(2);
    expect(t.queries[1]!.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/config/work' });
    t.manager.closeAll();
  });

  it('picks up a skill written during a session, in that session and in other folders', async () => {
    const t = setup();
    // A folder listed earlier, before the skill existed.
    await t.manager.commands(undefined, '/projects/web', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Make a skill' });
    await until(() => lastState(t.infos, id) === 'idle');
    await t.manager.commands(id, undefined, 'default');
    t.queries.at(-1)!.newSkills = [{ name: 'timesheet', description: 'Log a day', argumentHint: '' }];
    expect((await t.manager.commands(id, undefined, 'default')).map((c) => c.name)).toEqual(['review', 'timesheet']);
    // The other folder's list is stale now, so it is asked for again.
    const helpers = t.queries.length;
    await t.manager.commands(undefined, '/projects/web', 'default');
    expect(t.queries).toHaveLength(helpers + 1);
    t.manager.closeAll();
  });

  it('asks for every folder\'s commands again after skills are reloaded', async () => {
    const t = setup();
    await t.manager.commands(undefined, '/projects/web', 'default');
    await t.manager.commands(undefined, '/projects/web', 'work');
    expect(t.queries).toHaveLength(2);
    t.manager.reloadSkills(['default', 'work']);
    await t.manager.commands(undefined, '/projects/web', 'default');
    await t.manager.commands(undefined, '/projects/web', 'work');
    expect(t.queries).toHaveLength(4);
    t.manager.closeAll();
  });

  it('replaces the command list when Claude Code reports a change', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Hi' });
    await until(() => lastState(t.infos, id) === 'idle');
    await t.manager.commands(id, undefined, 'default');
    t.queries.at(-1)!.out.push({ type: 'system', subtype: 'commands_changed', session_id: id, commands: [{ name: 'timesheet', description: 'Log a day', argumentHint: '' }] });
    // The folder's list (used by New session) follows the running session's.
    await vi.waitFor(async () => expect((await t.manager.commands(undefined, '/work/app', 'default')).map((c) => c.name)).toEqual(['timesheet']));
    t.manager.closeAll();
  });

  it('runs each session with its profile, and resumes with the profile it was created with', async () => {
    const t = setup({ cwds: { old: '/work/app' }, profiles: { old: 'work' } });
    await t.manager.prewarm('/work/app', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'hi', profileId: 'work' });
    await until(() => lastState(t.infos, id) === 'idle');
    // The process pre-warmed for the default profile is not adopted by a session of another one.
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/config/work' });
    expect(t.infos.at(-1)).toMatchObject({ sessionId: id, profileId: 'work' });

    await t.manager.send({ sessionId: 'old', text: 'continue', attachments: [], fork: false });
    await until(() => t.queries.length === 2);
    expect(t.queries[1]!.options).toMatchObject({ resume: 'old', env: { CLAUDE_CONFIG_DIR: '/config/work' } });
    t.manager.closeAll();
  });

  it('closes a session on request', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.manager.close(id);
    expect(lastState(t.infos, id)).toBe('closed');
    await until(() => t.queries[0]!.closed);
  });

  it('resumes a stopped session in the permission mode it last had', async () => {
    const t = setup({ cwds: { old: '/w' } });
    await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => lastState(t.infos, 'old') === 'idle');
    expect(t.queries[0]!.options.permissionMode).toBe('default');
    await t.manager.setPermissionMode('old', 'auto');
    t.manager.close('old');

    await t.manager.send({ sessionId: 'old', text: 'again', attachments: [], fork: false });
    await until(() => t.queries.length === 2);
    expect(t.queries[1]!.options.permissionMode).toBe('auto');
    t.manager.closeAll();
  });

  it('resumes with the mode and model a session had, after the app restarts too', async () => {
    const settings = createMemorySessionSettings();
    const first = setup({ cwds: { old: '/w' }, settings });
    await first.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => lastState(first.infos, 'old') === 'idle');
    await first.manager.setPermissionMode('old', 'auto');
    await first.manager.setModel('old', 'sonnet');
    first.manager.closeAll();

    // A new manager is a restarted engine: only the store remembers.
    const second = setup({ cwds: { old: '/w' }, settings });
    await second.manager.send({ sessionId: 'old', text: 'again', attachments: [], fork: false });
    await until(() => second.queries.length === 1);
    expect(second.queries[0]!.options).toMatchObject({ permissionMode: 'auto', model: 'sonnet' });
    second.manager.closeAll();
  });

  it('passes on the model list Claude Code reports', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => t.models.length > 0);
    expect(t.models.at(-1)).toEqual([{ value: 'fake', displayName: 'Fake', description: 'Test model', supportsEffort: false }]);
    expect(t.manager.listModels()).toEqual(t.models.at(-1));
    t.manager.close(id);
  });

  it('follows mode changes Claude Code reports on its own', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.queries[0]!.out.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits', session_id: id });
    await until(() => t.infos.at(-1)?.permissionMode === 'acceptEdits');
    t.manager.closeAll();
  });

  it('tracks background tasks and keeps their session open while they run', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    const tasks = (list: unknown[]) => t.queries[0]!.out.push({ type: 'system', subtype: 'background_tasks_changed', tasks: list, session_id: id });
    tasks([
      { task_id: 'b1', task_type: 'local_bash', description: 'npm run test:links' },
      { task_id: 'w1', task_type: 'monitor', description: 'Watching files', ambient: true },
    ]);
    await until(() => t.infos.at(-1)!.backgroundTasks.length > 0);
    expect(t.infos.at(-1)).toMatchObject({ state: 'idle', backgroundTasks: [{ taskId: 'b1', type: 'local_bash', description: 'npm run test:links' }] });
    const startedAt = t.infos.at(-1)!.backgroundTasks[0]!.startedAt;

    // A second task joins: the first one keeps the time it was first seen.
    await new Promise((r) => setTimeout(r, 5));
    tasks([
      { task_id: 'b1', task_type: 'local_bash', description: 'npm run test:links' },
      { task_id: 'a1', task_type: 'local_agent', description: 'Review the diff' },
    ]);
    await until(() => t.infos.at(-1)!.backgroundTasks.length === 2);
    const [first, second] = t.infos.at(-1)!.backgroundTasks;
    expect(first!.startedAt).toBe(startedAt);
    expect(second!.startedAt).toBeGreaterThan(startedAt);

    await t.manager.stopTask(id, 'a1');
    expect(t.queries[0]!.stoppedTasks).toEqual(['a1']);

    // Long idle, but a task is still running: the reaper leaves it alone.
    t.manager.reapIdle(Date.now() + 2 * 60 * 60_000);
    expect(lastState(t.infos, id)).toBe('idle');

    tasks([]);
    await until(() => t.infos.at(-1)!.backgroundTasks.length === 0);
    t.manager.reapIdle(Date.now() + 2 * 60 * 60_000);
    expect(lastState(t.infos, id)).toBe('closed');
    t.manager.closeAll();
  });
});

describe('buildOptions', () => {
  const config: HostConfig = {
    sessionId: 's1',
    cwd: '/repo',
    profileId: 'default',
    mode: 'new',
    model: 'opus',
    permissionMode: 'acceptEdits',
    effort: 'high',
    worktree: { name: 'fix-login', baseRef: 'head' },
    env: { PATH: '/bin' },
    claudePath: '/bin/claude',
    canUseTool: async () => ({ behavior: 'deny', message: '' }),
  };
  it('maps a new worktree session onto Claude Code options', () => {
    const options = buildOptions(config, () => {});
    expect(options).toMatchObject({
      cwd: '/repo',
      sessionId: 's1',
      model: 'opus',
      effort: 'high',
      permissionMode: 'acceptEdits',
      extraArgs: { worktree: 'fix-login' },
      settings: { worktree: { baseRef: 'head' } },
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      pathToClaudeCodeExecutable: '/bin/claude',
    });
    expect(options.env).toEqual({ PATH: '/bin', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' });
    expect(options.resume).toBeUndefined();
  });
  it('resumes or forks instead of assigning an id', () => {
    expect(buildOptions({ ...config, mode: 'resume', worktree: null }, () => {})).toMatchObject({ resume: 's1' });
    const resume = buildOptions({ ...config, mode: 'resume', worktree: null }, () => {});
    expect(resume.sessionId).toBeUndefined();
    // A fork resumes the original under the id we gave it.
    const fork = buildOptions({ ...config, sessionId: 'f1', forkFrom: 's1', mode: 'fork', worktree: null, model: null, effort: null }, () => {});
    expect(fork).toMatchObject({ resume: 's1', forkSession: true, sessionId: 'f1' });
    expect(fork.model).toBeUndefined();
    expect(() => buildOptions({ ...config, mode: 'fork', worktree: null }, () => {})).toThrow(/forks from/);
  });
});

describe('describeSuggestions', () => {
  it('says what always-allow changes', () => {
    expect(describeSuggestions(undefined)).toBeNull();
    expect(describeSuggestions([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe('Switch to Accept edits for this session');
    expect(describeSuggestions([{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'userSettings' }])).toBe('Allow WebFetch everywhere');
  });
});
