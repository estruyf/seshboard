import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_MODEL, type AutoModelPrefs } from '@switchboard/protocol';
import type { SdkRuntime } from '../host/hostManager.ts';
import { clampTier, ModelRouter, parseRoute, ROUTE_FAILURES, stubRoute, type RoutingRecord } from './router.ts';
import { routingSystemPrompt, routingUserMessage } from './routingRules.ts';

describe('parseRoute', () => {
  it('reads the model and reason from strict JSON, also with text around it', () => {
    expect(parseRoute('{"model":"sonnet","reason":"A small, local change."}', ['haiku', 'sonnet', 'opus'])).toEqual({ model: 'sonnet', reason: 'A small, local change.' });
    expect(parseRoute('Sure: {"model":" OPUS ","reason":"Planning\\nacross  files."} done', ['haiku', 'sonnet', 'opus'])).toEqual({ model: 'opus', reason: 'Planning across files.' });
  });

  it('clamps the model to the allowed ones', () => {
    expect(parseRoute('{"model":"opus","reason":"Big."}', ['haiku', 'sonnet'])?.model).toBe('sonnet');
    expect(parseRoute('{"model":"haiku","reason":"Quick."}', ['opus'])?.model).toBe('opus');
  });

  it('gives a plain reason when Haiku leaves it out, and keeps it short', () => {
    expect(parseRoute('{"model":"haiku"}', ['haiku'])?.reason).toBe('Picked from your prompt.');
    expect(parseRoute(`{"model":"haiku","reason":"${'x'.repeat(400)}"}`, ['haiku'])?.reason).toHaveLength(200);
  });

  it('treats anything else as unusable', () => {
    for (const text of ['', 'Sonnet', '{"model":"gpt"}', '{"model":42}', '{not json}', '[]', '{"reason":"no model"}']) expect(parseRoute(text, ['haiku', 'sonnet', 'opus'])).toBeNull();
    expect(parseRoute('{"model":"sonnet"}', [])).toBeNull();
  });
});

describe('clampTier', () => {
  it('takes the nearest allowed model, the stronger one on a tie', () => {
    expect(clampTier('sonnet', ['haiku', 'opus'])).toBe('opus');
    expect(clampTier('opus', ['haiku'])).toBe('haiku');
    expect(clampTier('haiku', ['sonnet', 'opus'])).toBe('sonnet');
    expect(clampTier('haiku', [])).toBeNull();
  });
});

describe('routing rules', () => {
  it('lists only the allowed models and the lean', () => {
    const prompt = routingSystemPrompt(['haiku', 'sonnet'], 'cheaper');
    expect(prompt).toContain('"model":"haiku|sonnet"');
    expect(prompt).not.toMatch(/^- opus/m);
    expect(prompt).toContain('pick the cheaper one');
  });

  it('sends the text and a note about images it cannot see', () => {
    expect(routingUserMessage('Fix it', 0)).toBe('<request>\nFix it\n</request>');
    expect(routingUserMessage('Fix it', 2)).toContain('2 attached images, not shown here');
  });
});

interface Call {
  options: Record<string, unknown>;
  messages: unknown[];
}

/** A Claude Code stand-in for the routing call: answers `answer` (or never, or throws), with some tokens. */
function routerSdk(calls: Call[], answer: { text?: string; hang?: boolean; fail?: boolean; tokens?: number }): SdkRuntime {
  return {
    query: ({ prompt, options }) => {
      const call: Call = { options: options as Record<string, unknown>, messages: [] };
      calls.push(call);
      let closed: () => void = () => {};
      const closedNow = new Promise<void>((resolve) => (closed = resolve));
      return {
        async *[Symbol.asyncIterator]() {
          for await (const message of prompt) call.messages.push(message.message.content);
          yield { type: 'system', subtype: 'init' };
          if (answer.fail) throw new Error('spawn failed');
          if (answer.hang) {
            await closedNow;
            throw new Error('closed');
          }
          const tokens = answer.tokens ?? 900;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: answer.text ?? '',
            modelUsage: { 'claude-haiku-4-5': { inputTokens: tokens, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
          };
        },
        close: () => closed(),
      } as never;
    },
    startup: async () => ({}) as never,
  };
}

function routerFor(sdk: SdkRuntime, prefs: AutoModelPrefs = DEFAULT_AUTO_MODEL, extra: { answerMs?: number } = {}) {
  const records: Array<{ profileId: string; entry: Omit<RoutingRecord, 'scope'> }> = [];
  const hidden: string[] = [];
  const router = new ModelRouter({
    sdk: async () => sdk,
    env: async (profileId) => ({ PROFILE: profileId }),
    claudePath: async () => '/bin/claude',
    ephemeral: { add: (id) => hidden.push(id), delete: () => {} },
    prefs: () => prefs,
    record: (profileId, entry) => records.push({ profileId, entry }),
    log: () => {},
    ...extra,
  });
  return { router, records, hidden };
}

describe('ModelRouter', () => {
  it('asks Haiku with only the prompt text and an image count, and no tools, settings or memory', async () => {
    const calls: Call[] = [];
    const { router, hidden } = routerFor(routerSdk(calls, { text: '{"model":"sonnet","reason":"A small change."}' }));
    const result = await router.route({ profileId: 'work', prompt: 'Rename the setting in General', imageCount: 3 });
    expect(result).toMatchObject({ ok: true, model: 'sonnet', reason: 'A small change.', tokens: 930, estimateVsOpus: 0.6, allowed: ['haiku', 'sonnet', 'opus'] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages).toEqual([routingUserMessage('Rename the setting in General', 3)]);
    expect(calls[0]!.options).toMatchObject({ model: 'haiku', tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], maxTurns: 1, persistSession: false, env: { PROFILE: 'work' } });
    // Never the project's folder: the home folder, so no CLAUDE.md is found either.
    expect(String(calls[0]!.options.cwd)).not.toContain('work');
    expect(calls[0]!.options.sessionId).toBe(hidden[0]);
  });

  it('records the call\'s tokens on the profile it ran on, with what it picked', async () => {
    const { router, records } = routerFor(routerSdk([], { text: '{"model":"opus","reason":"Planning."}', tokens: 1_000 }));
    const result = await router.route({ profileId: 'work', prompt: 'Plan the migration', imageCount: 0 });
    expect(records).toEqual([{ profileId: 'work', entry: expect.objectContaining({ model: 'claude-haiku-4-5', picked: 'opus', tokens: { input: 1_000, output: 30, cacheRead: 0, cacheWrite: 0 } }) }]);
    expect(result.ok && result.routeId).toBe(records[0]!.entry.id);
  });

  it('clamps to the allowed models', async () => {
    const { router } = routerFor(routerSdk([], { text: '{"model":"opus","reason":"Big."}' }), { ...DEFAULT_AUTO_MODEL, allowed: ['haiku', 'sonnet'] });
    expect(await router.route({ profileId: 'p', prompt: 'x', imageCount: 0 })).toMatchObject({ ok: true, model: 'sonnet' });
  });

  it('falls back when Haiku answers something unusable, and still counts its tokens', async () => {
    const { router, records } = routerFor(routerSdk([], { text: 'I think Sonnet would be good.' }));
    const result = await router.route({ profileId: 'p', prompt: 'x', imageCount: 0 });
    expect(result).toMatchObject({ ok: false, reason: ROUTE_FAILURES.unusable, tokens: 930 });
    expect(records[0]!.entry.picked).toBeNull();
  });

  it('falls back when Haiku takes too long', async () => {
    const { router, records } = routerFor(routerSdk([], { hang: true }), DEFAULT_AUTO_MODEL, { answerMs: 20 });
    const result = await router.route({ profileId: 'p', prompt: 'x', imageCount: 0 });
    expect(result).toMatchObject({ ok: false, reason: ROUTE_FAILURES.timeout, tokens: 0, routeId: null });
    expect(records).toEqual([]);
  });

  it('falls back when Claude Code fails', async () => {
    const { router } = routerFor(routerSdk([], { fail: true }));
    expect(await router.route({ profileId: 'p', prompt: 'x', imageCount: 0 })).toMatchObject({ ok: false, reason: ROUTE_FAILURES.failed });
  });

  it('never calls a model when stubbed', async () => {
    const calls: Call[] = [];
    const router = new ModelRouter({
      sdk: async () => routerSdk(calls, {}),
      env: async () => ({}),
      claudePath: async () => undefined,
      ephemeral: { add: () => {}, delete: () => {} },
      prefs: () => DEFAULT_AUTO_MODEL,
      record: () => {},
      log: () => {},
      stub: stubRoute,
    });
    expect(await router.route({ profileId: 'p', prompt: 'Plan the refactor of the parser', imageCount: 0 })).toMatchObject({ ok: true, model: 'opus' });
    expect(await router.route({ profileId: 'p', prompt: 'What does this flag do?', imageCount: 0 })).toMatchObject({ ok: true, model: 'haiku' });
    expect(calls).toEqual([]);
  });
});
