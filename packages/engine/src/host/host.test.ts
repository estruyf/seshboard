import type { Options, PermissionResult, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModelOption, PermissionRequest, QueuedMessage, SessionHostInfo, StreamDelta } from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { HostManager, type HostManagerDeps, type SdkRuntime } from './hostManager.ts';
import type { LimitStop } from '../usageLimit/usageLimit.ts';
import { describeSuggestions, RECHECK_MESSAGE } from './permissions.ts';
import { buildOptions, CLAUDE_MISSING_MESSAGE, failureMessage, type HostConfig } from './sessionHost.ts';
import { createMemorySessionSettings, createSessionSettingsStore, type SessionSettingsStore } from './sessionSettings.ts';
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

const EDIT_SUGGESTION = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] as const;

/**
 * Scripted stand-in for a Claude Code process. Prompts starting with `bash:` ask for permission, `tools:Write,Bash`
 * makes those tool calls and asks for each at once, `serial:Write,Write` one after the other; `crash` kills it.
 */
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
  /** The folder Claude's shell is in, which `cd` moves; each turn's init reports it. */
  shellCwd: string | undefined;
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
      this.out.push({ type: 'system', subtype: 'init', session_id: sessionId, cwd: this.shellCwd ?? this.options.cwd, model: this.model, permissionMode: this.mode });
      state('running');
      if (text.startsWith('<side-question>')) {
        await this.answerSideQuestion(sessionId, text);
        state('idle');
        continue;
      }
      if (text.startsWith('limit')) {
        // A usage limit: Claude Code reports it rejected, says so as an error message, and the turn ends as an error.
        const said = "You've hit your limit · resets 3pm";
        this.out.push({ type: 'rate_limit_event', session_id: sessionId, rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_760_000_000 } });
        this.out.push({ type: 'assistant', uuid: `a-${text}`, error: 'rate_limit', parent_tool_use_id: null, session_id: sessionId, message: { model: 'fake', content: [{ type: 'text', text: said }] } });
        this.out.push({ type: 'result', subtype: 'success', is_error: true, result: said, total_cost_usd: 0, session_id: sessionId });
        state('idle');
        continue;
      }
      if (text === 'crash') {
        this.out.fail(new Error('Claude Code process exited with code 1'));
        return;
      }
      if (text.startsWith('tools:') || text.startsWith('serial:')) {
        const [kind, list] = text.split(':') as [string, string];
        const tools = list.split(',');
        this.out.push({ type: 'assistant', uuid: 'a-calls', parent_tool_use_id: null, session_id: sessionId, message: { model: 'fake', content: tools.map((name, i) => ({ type: 'tool_use', id: `tool-${this.received.length}-${i + 1}`, name, input: {} })) } });
        state('requires_action');
        const ask = (tool: string, i: number) =>
          this.options.canUseTool!(tool, { tool }, {
            signal: new AbortController().signal,
            suggestions: (tool === 'Write' ? [...EDIT_SUGGESTION] : []) as never,
            toolUseID: `tool-${this.received.length}-${i + 1}`,
          } as never) as Promise<PermissionResult>;
        const results: PermissionResult[] = [];
        if (kind === 'tools') results.push(...(await Promise.all(tools.map(ask))));
        else for (const [i, tool] of tools.entries()) results.push(await ask(tool, i));
        state('running');
        assistant(results.map((r, i) => `${tools[i]}=${r.behavior === 'deny' && r.message === RECHECK_MESSAGE ? 'recheck' : r.behavior}`).join(' '));
      } else if (text.startsWith('bash:')) {
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
        if (text === 'cache') {
          // A reply that wrote to the hour-long prompt cache.
          const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 5 } };
          this.out.push({ type: 'assistant', uuid: 'a-cache', parent_tool_use_id: null, session_id: sessionId, message: { model: 'fake', content: [{ type: 'text', text: 'Hello' }], usage } });
        } else assistant('Hello');
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
  /** What the PreToolUse hook decided for each tool a side question tried. */
  hookDecisions: Array<{ tool: string; decision: string }> = [];
  /**
   * A side question: Claude tries to read a file and to write one (through the PreToolUse hook), says what it reads
   * next (text the answer drops), then streams its answer. Each response repeats its usage on every block.
   */
  private async answerSideQuestion(sessionId: string, text: string) {
    const hook = this.options.hooks?.PreToolUse?.[0]?.hooks[0];
    for (const [tool, input] of [['Read', { file_path: '/work/app/README.md' }], ['Write', { file_path: '/work/app/x.txt', content: 'x' }]] as const) {
      const out = (await hook?.({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never, undefined, { signal: new AbortController().signal })) as { hookSpecificOutput?: { permissionDecision?: string } } | undefined;
      this.hookDecisions.push({ tool, decision: out?.hookSpecificOutput?.permissionDecision ?? 'none' });
    }
    const usage = { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100 };
    const delta = (chunk: string) => this.out.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } } });
    delta('Let me look.');
    for (const block of [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', name: 'Read' }]) {
      this.out.push({ type: 'assistant', parent_tool_use_id: null, session_id: sessionId, message: { id: 'msg-1', model: 'fake', usage, content: [block] } });
    }
    const question = text.split('\n').at(-1);
    for (const chunk of ['Answer to ', question]) delta(chunk!);
    this.out.push({ type: 'assistant', parent_tool_use_id: null, session_id: sessionId, message: { id: 'msg-2', model: 'fake', usage, content: [{ type: 'text', text: `Answer to ${question}` }] } });
    this.out.push({ type: 'result', subtype: 'success', is_error: false, result: `Answer to ${question}`, session_id: sessionId });
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
  opts: {
    openElsewhere?: string[];
    cwds?: Record<string, string>;
    profiles?: Record<string, string>;
    settings?: SessionSettingsStore;
    refreshLive?: () => void;
    upNext?: ReturnType<typeof memoryUpNext>;
    /** Pre-warmed processes fail to start, at once or after a while (no login, a crash). */
    warmFails?: { message: string; afterMs?: number };
    /** Claude Code can't be started at all. */
    startFails?: string;
    /** Sees each process as it starts, before it gets a message. */
    onQuery?: (query: FakeQuery) => void;
    limits?: HostManagerDeps['limits'];
    links?: HostManagerDeps['links'];
  } = {},
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
  const turns: Array<{ sessionId: string; ok: boolean; error: string | null; stopped?: boolean; superseded?: boolean }> = [];
  const warmups: Array<{ options: Options; closed: boolean }> = [];
  const ephemeral = new Set<string>();
  const sdk: SdkRuntime = {
    query: ({ prompt, options }) => {
      if (opts.startFails) throw new Error(opts.startFails);
      const q = new FakeQuery(prompt, options);
      queries.push(q);
      opts.onQuery?.(q);
      return q as never;
    },
    USAGE_LIMIT_ERROR_PREFIXES: ["You've hit your", "You've reached your"],
    startup: async ({ options }) => {
      const warmup = { options, closed: false };
      warmups.push(warmup);
      if (opts.warmFails) {
        await new Promise((r) => setTimeout(r, opts.warmFails!.afterMs ?? 0));
        throw new Error(opts.warmFails.message);
      }
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
    onTurnEnd: (sessionId, outcome) => turns.push({ sessionId, ...outcome }),
    sessionSettings: opts.settings,
    limits: opts.limits,
    links: opts.links,
    upNext: opts.upNext,
    onUpNext: (sessionId, queue) => upNextEvents.push({ sessionId, queue }),
    onModels: (m) => models.push(m),
    ephemeral,
    log: () => {},
  });
  return { manager, queries, infos, streams, messages, permissions, resolved, created, models, warmups, ephemeral, upNextEvents, turns };
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

  it('keeps the session in its folder when Claude cds into a subfolder, and follows it into a worktree', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.queries[0]!.shellCwd = '/work/app/packages/ui';
    await t.manager.send({ sessionId: id, text: 'again', attachments: [], fork: false });
    await until(() => t.queries[0]!.received.length === 2 && lastState(t.infos, id) === 'idle');
    expect(t.infos.at(-1)!.cwd).toBe('/work/app');
    t.queries[0]!.shellCwd = '/work/app/.claude/worktrees/fix-login';
    await t.manager.send({ sessionId: id, text: 'and again', attachments: [], fork: false });
    await until(() => t.infos.at(-1)!.cwd === '/work/app/.claude/worktrees/fix-login');
    t.manager.closeAll();
  });

  it('reports when a turn last used the prompt cache, and which cache it is', async () => {
    const t = setup();
    const before = Date.now();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'Say hi' });
    await until(() => lastState(t.infos, id) === 'idle');
    // A reply without usage says nothing about the cache.
    expect(t.infos.at(-1)!.cacheAt).toBeUndefined();
    await t.manager.send({ sessionId: id, text: 'cache', attachments: [], fork: false });
    await until(() => t.infos.at(-1)!.cacheTtl === '1h');
    expect(t.infos.at(-1)!.cacheAt).toBeGreaterThanOrEqual(before);
    t.manager.closeAll();
  });

  it('reports each turn\'s end, finished or failed, for its catch-up', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'Say hi' });
    await until(() => t.turns.length === 1);
    expect(t.turns).toEqual([{ sessionId: id, ok: true, error: null, stopped: false, superseded: false }]);
    await t.manager.send({ sessionId: id, text: 'fail', attachments: [], fork: false });
    await until(() => t.turns.length === 2);
    expect(t.turns[1]).toMatchObject({ sessionId: id, ok: false, stopped: false });
    t.manager.closeAll();
  });

  it('says a turn you stopped was stopped, whatever its result, for queued items that start after it', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
    await until(() => t.permissions.length === 1);
    await t.manager.interrupt(id);
    await until(() => t.turns.length === 1);
    expect(t.turns[0]).toMatchObject({ sessionId: id, stopped: true, superseded: false });
    // The next turn is its own.
    await t.manager.send({ sessionId: id, text: 'Say hi', attachments: [], fork: false });
    await until(() => t.turns.length === 2);
    expect(t.turns[1]).toMatchObject({ ok: true, stopped: false });
    t.manager.closeAll();
  });

  it('sets the profile\'s usage limit when a turn stops on it, holds the queue, and lets it go once a turn gets through', async () => {
    // The profile's limit, kept as UsageLimits keeps it (that class has its own tests).
    let limit: (LimitStop & { profileId: string; sessionIds: string[] }) | null = null;
    const hits: Array<{ profileId: string; sessionId: string }> = [];
    let manager: HostManager | undefined;
    const t = setup({
      limits: {
        of: (profileId) => (limit?.profileId === profileId ? { ...limit, since: 0 } : null),
        hit: (profileId, sessionId, stop) => {
          hits.push({ profileId, sessionId });
          limit = { ...stop, profileId, sessionIds: [sessionId] };
        },
        ok: (profileId) => {
          if (limit?.profileId !== profileId) return;
          limit = null;
          manager!.limitChanged(profileId);
        },
      },
    });
    manager = t.manager;
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'limit' });
    await until(() => lastState(t.infos, id) === 'idle' && t.turns.length === 1);
    expect(hits).toEqual([{ profileId: 'default', sessionId: id }]);
    expect(limit).toMatchObject({ kind: 'five_hour', resetsAt: 1_760_000_000_000, message: "You've hit your limit · resets 3pm" });
    expect(t.turns[0]).toMatchObject({ ok: false });

    // The session reports the limit, and what you queue waits for it instead of running into it.
    t.manager.limitChanged('default');
    expect(t.infos.at(-1)).toMatchObject({ sessionId: id, usageLimit: { profileId: 'default', kind: 'five_hour' } });
    // Not the error hold: the queue moves on by itself once the limit is cleared.
    expect(t.infos.at(-1)!.queueHold).toBeNull();

    // A message sent while the limit holds still goes (it is yours); when it gets through, the limit is cleared.
    await t.manager.send({ sessionId: id, text: 'Say hi', attachments: [], fork: false });
    await until(() => t.turns.length === 2);
    expect(limit).toBeNull();
    await until(() => t.infos.at(-1)!.usageLimit === null);
    t.manager.closeAll();
  });

  it('holds Up next while the profile is at a usage limit, and sends it once the limit is cleared', async () => {
    let limited = true;
    const t = setup({ limits: { of: (profileId) => (limited ? { profileId, kind: null, resetsAt: null, since: 0, message: null, sessionIds: [] } : null), hit: () => {}, ok: () => {} } });
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
    await until(() => t.permissions.length === 1);
    await t.manager.send({ sessionId: id, text: 'Then the docs', attachments: [], fork: false });
    t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
    await until(() => lastState(t.infos, id) === 'idle');
    await new Promise((r) => setTimeout(r, 30));
    expect(t.queries[0]!.received.map((r) => r.text)).toEqual(['bash:npm test']);
    limited = false;
    t.manager.limitChanged('default');
    await until(() => t.queries[0]!.received.length === 2);
    expect(t.queries[0]!.received.at(-1)!.text).toBe('Then the docs');
    t.manager.closeAll();
  });

  it('writes linked sessions\' briefs as each message goes to Claude Code, a queued one when it goes', async () => {
    let version = 1;
    const warmed: string[] = [];
    const t = setup({
      links: {
        expand: (id, text) => text.replace('[stub]', `[brief ${version} for ${id}]`),
        warm: async (text) => void warmed.push(text),
      },
    });
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test [stub]' });
    await until(() => t.permissions.length === 1);
    expect(t.queries[0]!.received[0]!.text).toBe(`bash:npm test [brief 1 for ${id}]`);
    // Queued while Claude works: written when it goes, with what is true then.
    await t.manager.send({ sessionId: id, text: 'Then stack on [stub]', attachments: [], fork: false });
    version = 2;
    t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow' });
    await until(() => t.queries[0]!.received.length === 2);
    expect(t.queries[0]!.received[1]!.text).toBe(`Then stack on [brief 2 for ${id}]`);
    // The transcript shows what Claude read.
    expect(JSON.stringify(t.messages)).toContain(`[brief 2 for ${id}]`);
    expect(warmed).toEqual(['bash:npm test [stub]', 'Then stack on [stub]']);
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

  it('sends waiting prompts back to Claude Code when the mode changes to one that would let them run', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'tools:Write,Bash,AskUserQuestion' });
    await until(() => t.permissions.length === 3);
    // Accept edits only lets the edit run: the command and the question keep waiting.
    await t.manager.setPermissionMode(id, 'acceptEdits');
    expect(t.queries[0]!.mode).toBe('acceptEdits');
    expect(t.manager.list().permissions.map((p) => p.toolName)).toEqual(['Bash', 'AskUserQuestion']);
    // Auto mode decides the command itself; no mode answers a question.
    await t.manager.setPermissionMode(id, 'auto');
    expect(t.manager.list().permissions.map((p) => p.toolName)).toEqual(['AskUserQuestion']);
    // Ask before edits lets nothing more run.
    await t.manager.setPermissionMode(id, 'default');
    expect(t.manager.list().permissions).toHaveLength(1);
    t.manager.respond(t.permissions[2]!.requestId, { behavior: 'allow' });
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-Write=recheck Bash=recheck AskUserQuestion=allow')));
    t.manager.closeAll();
  });

  it('sends back a prompt that a call made before the mode change asks for later', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'serial:Write,Write,Bash' });
    await until(() => t.permissions.length === 1);
    // Auto mode decides calls as they arrive: the later ones were decided under the old mode, so they go back too.
    await t.manager.setPermissionMode(id, 'auto');
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-Write=recheck Write=recheck Bash=recheck')));
    expect(t.permissions).toHaveLength(1);
    // Claude's new attempts are new calls: they ask as usual.
    await t.manager.send({ sessionId: id, text: 'serial:Write', attachments: [], fork: false });
    await until(() => t.permissions.length === 2);
    t.manager.closeAll();
  });

  it('sends the other waiting edits back when "always" switches to Accept edits', async () => {
    const t = setup();
    await t.manager.create({ ...base, cwd: '/w', prompt: 'tools:Write,Write,Bash' });
    await until(() => t.permissions.length === 3);
    t.manager.respond(t.permissions[0]!.requestId, { behavior: 'allow', always: true });
    expect(t.manager.list().permissions.map((p) => p.toolName)).toEqual(['Bash']);
    t.manager.respond(t.permissions[2]!.requestId, { behavior: 'deny' });
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-Write=allow Write=recheck Bash=deny')));
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

    it('answers a question about a running session from a fork, without touching the turn, the queue or the transcript', async () => {
      const cwds: Record<string, string> = {};
      const t = setup({ cwds });
      const id = await busy(t);
      cwds[id] = '/w';
      await send(t, id, 'Then the docs');
      await t.manager.setModel(id, 'opus');
      const infosBefore = t.infos.length;
      const messagesBefore = t.messages.length;

      await expect(t.manager.askAbout(id, '<side-question>\n</side-question>\n\nWhich flag?', () => {})).resolves.toMatchObject({ answer: 'Answer to Which flag?' });
      // A fork of its own, on the session's model; the session's process never got it as a message.
      expect(t.queries).toHaveLength(2);
      expect(t.queries[1]!.options).toMatchObject({ resume: id, forkSession: true, persistSession: false, cwd: '/w', model: 'opus' });
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
      t.manager.closeAll();
    });

    it('answers a question from a fork that writes nothing, with read-only tools, streaming, and its tokens', async () => {
      const t = setup({ cwds: { 'old-1': '/work/app' }, openElsewhere: ['old-1'] });
      const texts: unknown[] = [];
      const result = await t.manager.askAbout('old-1', '<side-question>\nframing\n</side-question>\n\nWhat changed?', (text) => texts.push(text));
      expect(result).toEqual({ answer: 'Answer to What changed?', usage: [{ model: 'fake', tokens: { input: 6, output: 40, cacheRead: 10_000, cacheWrite: 200 } }] });
      // What came before the tool call is dropped; the answer streams after it.
      expect(texts).toEqual([{ delta: 'Let me look.' }, { reset: true }, { delta: 'Answer to ' }, { delta: 'What changed?' }]);
      // Not resumed: a short-lived fork that persists nothing, even with the session open in another window.
      expect(t.manager.has('old-1')).toBe(false);
      expect(t.queries).toHaveLength(1);
      const q = t.queries[0]!;
      expect(q.options).toMatchObject({ resume: 'old-1', forkSession: true, persistSession: false, cwd: '/work/app', includePartialMessages: true });
      expect(q.options.sessionId).not.toBe('old-1');
      expect(q.options.tools).toBeUndefined();
      // Reading goes through; anything else is denied by the hook.
      expect(q.hookDecisions).toEqual([
        { tool: 'Read', decision: 'allow' },
        { tool: 'Write', decision: 'deny' },
      ]);
      await expect(q.options.canUseTool!('Edit', { file_path: 'x' }, {} as never)).resolves.toMatchObject({ behavior: 'deny' });
      await expect(q.options.canUseTool!('Bash', { command: 'git diff HEAD~1' }, {} as never)).resolves.toMatchObject({ behavior: 'allow' });
      expect(q.closed).toBe(true);
      expect(t.ephemeral.has(q.options.sessionId!)).toBe(true);
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

    it('sends Up next once the turn has ended when Stop lets it continue (from a phone)', async () => {
      const t = setup();
      const id = await busy(t);
      await send(t, id, 'later');
      await t.manager.interrupt(id, 'continue');
      await until(() => t.queries[0]!.received.some((r) => r.text === 'later'));
      expect(t.infos.filter((i) => i.sessionId === id).every((i) => i.queueHold !== 'stopped' && i.queueHold !== 'error')).toBe(true);
      expect(queue(t, id)).toHaveLength(0);
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

  describe('pipeline steps (#179)', () => {
    /** What the PreToolUse hook of a process decides for a tool call. */
    const decide = async (query: FakeQuery, tool: string, input: Record<string, unknown>) => {
      const hook = query.options.hooks?.PreToolUse?.[0]?.hooks[0];
      const out = (await hook?.({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never, undefined, { signal: new AbortController().signal })) as { hookSpecificOutput?: { permissionDecision?: string } } | undefined;
      return out?.hookSpecificOutput?.permissionDecision ?? 'none';
    };

    it('starts a read-only session behind a hook that lets only reading through, without a warm process', async () => {
      const t = setup();
      await t.manager.prewarm('/w', 'default');
      expect(t.warmups).toHaveLength(1);
      const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'Review it', readOnly: true });
      // The warm process had no hook: this session got a process of its own.
      expect(t.warmups.every((w) => !t.queries.some((q) => q.options === w.options))).toBe(true);
      const q = t.queries.find((query) => query.options.sessionId === id)!;
      expect(await decide(q, 'Read', { file_path: '/w/a.ts' })).toBe('allow');
      expect(await decide(q, 'Bash', { command: 'git diff main...' })).toBe('allow');
      expect(await decide(q, 'Write', { file_path: '/w/a.ts' })).toBe('deny');
      expect(await decide(q, 'Bash', { command: 'npm test' })).toBe('deny');
      t.manager.closeAll();
    });

    it('gives an ordinary session no hook', async () => {
      const t = setup();
      await t.manager.create({ ...base, cwd: '/w', prompt: 'Build it' });
      expect(t.queries[0]!.options.hooks).toBeUndefined();
      t.manager.closeAll();
    });

    it('keeps a session read only when it is resumed after the process stopped', async () => {
      const cache = openCacheDatabase(join(mkdtempSync(join(tmpdir(), 'sb-ro-')), 'cache.db'));
      try {
        const settings = createSessionSettingsStore(cache.db);
        const t = setup({ settings, cwds: {} });
        const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'Review it', readOnly: true });
        await until(() => lastState(t.infos, id) === 'idle');
        expect(settings.get(id)?.readOnly).toBe(true);
        t.manager.close(id);
        await until(() => t.queries[0]!.closed);
        // A new engine (the app restarted) resumes it from what the database kept.
        const again = setup({ settings, cwds: { [id]: '/w' } });
        await again.manager.send({ sessionId: id, text: 'and now?', attachments: [], fork: false });
        expect(again.queries[0]!.options.resume).toBe(id);
        expect(await decide(again.queries[0]!, 'Edit', { file_path: '/w/a.ts' })).toBe('deny');
        again.manager.closeAll();
        t.manager.closeAll();
      } finally {
        cache.close();
      }
    });

    it('forks on the model, effort, mode and read-only choice of the step, not the original’s', async () => {
      const settings = createMemorySessionSettings();
      settings.set('plan', { model: 'opus', effort: 'high', permissionMode: 'plan' });
      const t = setup({ settings, cwds: { plan: '/repo' } });
      const forked = await t.manager.send({
        sessionId: 'plan',
        text: 'Build the plan',
        attachments: [],
        fork: true,
        overrides: { model: 'sonnet', effort: null, permissionMode: 'acceptEdits', readOnly: false },
      });
      const options = t.queries[0]!.options;
      expect(options).toMatchObject({ resume: 'plan', forkSession: true, sessionId: forked.sessionId, model: 'sonnet', permissionMode: 'acceptEdits' });
      expect(options.effort).toBeUndefined();
      expect(options.hooks).toBeUndefined();
      // The fork keeps what it was started on, for its next resume.
      expect(settings.get(forked.sessionId)).toMatchObject({ model: 'sonnet', effort: null });
      // The original is untouched.
      expect(settings.get('plan')).toMatchObject({ model: 'opus', effort: 'high', permissionMode: 'plan' });
      t.manager.closeAll();
    });

    it('forks read only when asked, and keeps it', async () => {
      const settings = createMemorySessionSettings();
      const t = setup({ settings, cwds: { src: '/repo' } });
      const forked = await t.manager.send({ sessionId: 'src', text: 'Check it', attachments: [], fork: true, overrides: { readOnly: true } });
      expect(await decide(t.queries[0]!, 'Write', { file_path: 'x' })).toBe('deny');
      expect(settings.get(forked.sessionId)?.readOnly).toBe(true);
      t.manager.closeAll();
    });

    it('lets a fork without overrides carry on with the original’s model, as before', async () => {
      const settings = createMemorySessionSettings();
      settings.set('src', { model: 'opus', effort: 'low' });
      const t = setup({ settings, cwds: { src: '/repo' } });
      const forked = await t.manager.send({ sessionId: 'src', text: 'again', attachments: [], fork: true });
      expect(t.queries[0]!.options).toMatchObject({ model: 'opus', effort: 'low' });
      expect(settings.get(forked.sessionId)).toMatchObject({ model: 'opus', effort: 'low', readOnly: false });
      t.manager.closeAll();
    });
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

  it('answers "not running" for the context of a session whose process is exiting', async () => {
    let exiting = false;
    const t = setup({
      onQuery: (q) => {
        q.getContextUsage = async () => {
          if (!exiting) return { totalTokens: 124, maxTokens: 1000, percentage: 12.4, model: 'fake', categories: [] } as never;
          // The process goes away while the SDK asks it.
          q.out.fail(new Error('Claude Code process exited with code 1'));
          await new Promise((r) => setTimeout(r, 10));
          throw new Error('ProcessTransport is not ready for writing');
        };
      },
    });
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    await expect(t.manager.context(id)).resolves.toMatchObject({ percentage: 12.4 });
    exiting = true;
    await expect(t.manager.context(id)).rejects.toMatchObject({ code: 'NOT_RUNNING' });
    expect(lastState(t.infos, id)).toBe('error');
    await expect(t.manager.context(id)).rejects.toMatchObject({ code: 'NOT_RUNNING' });
    t.manager.closeAll();
  });

  it('ignores a startup message without a session id, so the session list keeps working', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-host-'));
    const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    try {
      const t = setup({ settings: createSessionSettingsStore(cache.db), onQuery: (q) => q.out.push({ type: 'system', subtype: 'init' }) });
      const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
      await until(() => lastState(t.infos, id) === 'idle');
      expect(t.infos.every((i) => i.sessionId === id && i.cwd === '/w')).toBe(true);
      expect(t.manager.list().hosts).toMatchObject([{ sessionId: id, cwd: '/w', state: 'idle' }]);
      // A host that got no proper id can't break the list either.
      expect(t.manager.autoPick(undefined as never)).toBeNull();
      t.manager.closeAll();
    } finally {
      cache.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('drops a pre-warmed process that failed, so the next pre-warm tries again and a session starts fresh', async () => {
    const t = setup({ warmFails: { message: 'Claude Code process exited with code 1' } });
    await t.manager.prewarm('/work/app', 'default');
    await new Promise((r) => setTimeout(r, 20));
    expect(t.ephemeral.size).toBe(1);
    await t.manager.prewarm('/work/app', 'default');
    expect(t.warmups).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 20));
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi', permissionMode: 'plan' });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.options).toMatchObject({ sessionId: id, permissionMode: 'plan' });
    t.manager.closeAll();
  });

  it('starts a fresh process when the pre-warmed one fails after a new session took it', async () => {
    const t = setup({ warmFails: { message: 'Claude Code process exited with code 1', afterMs: 30 } });
    await t.manager.prewarm('/work/app', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi', permissionMode: 'plan', model: 'opus' });
    expect(id).toBe(t.warmups[0]!.options.sessionId);
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.options).toMatchObject({ sessionId: id, permissionMode: 'plan', model: 'opus' });
    expect(t.queries[0]!.received).toEqual([{ text: 'Say hi' }]);
    t.manager.closeAll();
  });

  it('says why a new session could not start instead of "not running"', async () => {
    const t = setup({ warmFails: { message: 'Claude Code process exited with code 1', afterMs: 30 }, startFails: 'Not logged in · Please run /login' });
    await t.manager.prewarm('/work/app', 'default');
    await expect(t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi', permissionMode: 'plan' })).rejects.toMatchObject({
      code: 'START_FAILED',
      message: 'Not logged in · Please run /login',
    });
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

  it('starts sessions and the pre-warmed process with --chrome while Use Claude in Chrome is on', async () => {
    const t = setup();
    t.manager.setChrome(true);
    await t.manager.prewarm('/work/app', 'default');
    expect(t.warmups[0]!.options.extraArgs).toEqual({ chrome: null });
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries[0]!.options.extraArgs).toEqual({ chrome: null });
    t.manager.setChrome(false);
    const other = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, other) === 'idle');
    expect(t.queries[1]!.options.extraArgs).toBeUndefined();
    t.manager.closeAll();
  });

  it('drops the pre-warmed process when Use Claude in Chrome changes, and keeps it when it does not', async () => {
    const t = setup();
    await t.manager.prewarm('/work/app', 'default');
    // Main sends every setting again after any preference change: the same value keeps the process.
    t.manager.setChrome(false);
    expect(t.warmups[0]!.closed).toBe(false);
    t.manager.setChrome(true);
    await until(() => t.warmups[0]!.closed);
    // The next new session starts its own process, with the new value, instead of taking the old one.
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi' });
    expect(id).not.toBe(t.warmups[0]!.options.sessionId);
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries[0]!.options.extraArgs).toEqual({ chrome: null });
    // A pre-warm after the change starts with it.
    await t.manager.prewarm('/work/app', 'default');
    expect(t.warmups[1]!.options.extraArgs).toEqual({ chrome: null });
    t.manager.closeAll();
  });

  it('drops a pre-warm still starting when Use Claude in Chrome changes', async () => {
    const t = setup();
    const starting = t.manager.prewarm('/work/app', 'default');
    t.manager.setChrome(true);
    await starting;
    expect(t.warmups).toHaveLength(0);
    t.manager.closeAll();
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

  it('saves the model, effort and mode of a session that is not running, and resumes with them', async () => {
    const t = setup({ cwds: { old: '/w' } });
    await t.manager.setModel('old', 'sonnet');
    await t.manager.setEffort('old', 'high');
    await t.manager.setPermissionMode('old', 'acceptEdits');
    await expect(t.manager.setPermissionMode('old', 'bypassPermissions')).rejects.toMatchObject({ code: 'INVALID' });
    expect(t.manager.savedSettings('old')).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' });
    expect(t.queries).toHaveLength(0);

    await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => t.queries.length === 1);
    expect(t.queries[0]!.options).toMatchObject({ model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' });
    t.manager.closeAll();
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
  it('passes --chrome only when Use Claude in Chrome is on', () => {
    // Off (or not said): no flag, and no extraArgs at all without a worktree.
    expect(buildOptions({ ...config, worktree: null }, () => {}).extraArgs).toBeUndefined();
    expect(buildOptions({ ...config, worktree: null, chrome: false }, () => {}).extraArgs).toBeUndefined();
    expect(buildOptions(config, () => {}).extraArgs).toEqual({ worktree: 'fix-login' });
    // On: a null value, which the SDK passes as a bare `--chrome`.
    expect(buildOptions({ ...config, worktree: null, chrome: true }, () => {}).extraArgs).toEqual({ chrome: null });
    expect(buildOptions({ ...config, mode: 'resume', worktree: null, chrome: true }, () => {}).extraArgs).toEqual({ chrome: null });
  });
  it('keeps the worktree when Claude in Chrome is on too', () => {
    const options = buildOptions({ ...config, chrome: true }, () => {});
    expect(options.extraArgs).toEqual({ worktree: 'fix-login', chrome: null });
    expect(options.settings).toEqual({ worktree: { baseRef: 'head' } });
  });
});

describe('describeSuggestions', () => {
  it('says what always-allow changes', () => {
    expect(describeSuggestions(undefined)).toBeNull();
    expect(describeSuggestions([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe('Switch to Accept edits for this session');
    expect(describeSuggestions([{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'userSettings' }])).toBe('Allow WebFetch everywhere');
  });
});

describe('failureMessage', () => {
  const sdkError = 'Native CLI binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional.';
  it('says Claude Code is missing when no claude was found and the SDK has no binary of its own', () => {
    expect(failureMessage(sdkError, undefined)).toBe(CLAUDE_MISSING_MESSAGE);
  });
  it('keeps other errors, and this one when a claude was found', () => {
    expect(failureMessage(sdkError, '/usr/local/bin/claude')).toBe(sdkError);
    expect(failureMessage('Process exited with code 1', undefined)).toBe('Process exited with code 1');
  });
});
