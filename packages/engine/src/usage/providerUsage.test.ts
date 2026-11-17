import { describe, expect, it } from 'vitest';
import { codexUsage, copilotUsage } from './providerUsage.ts';

const copilotStart = JSON.stringify({ type: 'session.start', id: 'e0', timestamp: '2026-11-01T10:00:00Z', data: { sessionId: 's1', context: { cwd: '/work/app' } } });

/** A `session.shutdown` with the session's totals so far, per model. */
function shutdown(id: string, at: string, models: Record<string, { input: number; read: number; write: number; output: number; requests: number; nano?: number }>): string {
  const modelMetrics = Object.fromEntries(
    Object.entries(models).map(([model, m]) => [
      model,
      {
        requests: { count: m.requests, cost: 1 },
        usage: { inputTokens: m.input + m.read + m.write, outputTokens: m.output, cacheReadTokens: m.read, cacheWriteTokens: m.write },
        tokenDetails: { input: { tokenCount: m.input } },
        ...(m.nano !== undefined ? { totalNanoAiu: m.nano } : {}),
      },
    ]),
  );
  return JSON.stringify({ type: 'session.shutdown', id, timestamp: at, data: { shutdownType: 'routine', modelMetrics } });
}

describe('copilotUsage', () => {
  it("counts what each run added to the session's totals, at the cost Copilot gave in AI credits", () => {
    const lines = [
      copilotStart,
      shutdown('x1', '2026-11-01T11:00:00Z', { 'claude-sonnet-5': { input: 10, read: 1000, write: 200, output: 50, requests: 2, nano: 2e9 } }),
      // A resume that used another model too; the first model's totals moved on.
      shutdown('x2', '2026-11-02T09:00:00Z', {
        'claude-sonnet-5': { input: 15, read: 3000, write: 300, output: 80, requests: 3, nano: 5e9 },
        'gpt-5.4': { input: 7, read: 0, write: 0, output: 9, requests: 1, nano: 1e9 },
      }),
      // A resume that did nothing writes the same totals again.
      shutdown('x3', '2026-11-03T09:00:00Z', {
        'claude-sonnet-5': { input: 15, read: 3000, write: 300, output: 80, requests: 3, nano: 5e9 },
        'gpt-5.4': { input: 7, read: 0, write: 0, output: 9, requests: 1, nano: 1e9 },
      }),
    ];
    const found = copilotUsage(lines, 's1');
    expect(found.map(({ key, model, input, output, cacheRead, cacheWrite, turns, usd, cwd }) => ({ key, model, input, output, cacheRead, cacheWrite, turns, usd, cwd }))).toEqual([
      { key: 'copilot|x1|claude-sonnet-5', model: 'claude-sonnet-5', input: 10, output: 50, cacheRead: 1000, cacheWrite: 200, turns: 2, usd: 0.02, cwd: '/work/app' },
      { key: 'copilot|x2|claude-sonnet-5', model: 'claude-sonnet-5', input: 5, output: 30, cacheRead: 2000, cacheWrite: 100, turns: 1, usd: 0.03, cwd: '/work/app' },
      { key: 'copilot|x2|gpt-5.4', model: 'gpt-5.4', input: 7, output: 9, cacheRead: 0, cacheWrite: 0, turns: 1, usd: 0.01, cwd: '/work/app' },
    ]);
    expect(found[0]).toMatchObject({ sessionId: 's1', at: Date.parse('2026-11-01T11:00:00Z') });
  });

  it('prices a run without AI credits from the price table, and skips what it cannot read', () => {
    const lines = [copilotStart, 'not json', shutdown('x1', '2026-11-01T11:00:00Z', { 'claude-sonnet-4.6': { input: 1_000_000, read: 0, write: 0, output: 0, requests: 1 } })];
    // Sonnet 4.6: $3 per million input tokens.
    expect(copilotUsage(lines, 's1')[0]!.usd).toBeCloseTo(3);
    expect(copilotUsage([shutdown('x1', 'not a time', { m: { input: 1, read: 0, write: 0, output: 1, requests: 1 } })], 's1')).toEqual([]);
  });
});

const meta = JSON.stringify({ timestamp: '2026-11-06T13:48:17Z', type: 'session_meta', payload: { id: 't1', cwd: '/work/app' } });
const turn = (id: string, model: string) => JSON.stringify({ timestamp: '2026-11-06T13:48:19Z', type: 'turn_context', payload: { turn_id: id, model, cwd: '/work/app' } });
const usage = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const record = (response: string, turnId: string, input: number, cached: number, output: number) =>
  JSON.stringify({ timestamp: '2026-11-06T13:48:21Z', type: 'token_usage_record', payload: { thread_id: 't1', turn_id: turnId, response_id: response, usage: usage(input, cached, output) } });
const tokenCount = (total: number, input: number, cached: number, output: number) =>
  JSON.stringify({ timestamp: '2026-11-06T13:48:22Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: usage(input, cached, output) } } });

describe('codexUsage', () => {
  it("reads a record per response, with its turn's model, and leaves the cached tokens out of the input", () => {
    const lines = [meta, turn('u1', 'gpt-6-luna'), record('r1', 'u1', 20_921, 7_168, 5), tokenCount(20_926, 20_921, 7_168, 5), turn('u2', 'gpt-6.1-sol'), record('r2', 'u2', 100, 0, 10)];
    expect(codexUsage(lines).map(({ key, sessionId, model, input, cacheRead, output, cwd }) => ({ key, sessionId, model, input, cacheRead, output, cwd }))).toEqual([
      { key: 'codex|r1', sessionId: 't1', model: 'gpt-6-luna', input: 13_753, cacheRead: 7_168, output: 5, cwd: '/work/app' },
      { key: 'codex|r2', sessionId: 't1', model: 'gpt-6.1-sol', input: 100, cacheRead: 0, output: 10, cwd: '/work/app' },
    ]);
  });

  it("reads an older file's token counts by the thread's running total, so one written twice counts once", () => {
    const lines = [meta, turn('u1', 'gpt-5.3-codex'), tokenCount(105, 100, 40, 5), tokenCount(105, 100, 40, 5), tokenCount(320, 200, 0, 15)];
    expect(codexUsage(lines).map((l) => [l.key, l.model, l.input, l.cacheRead, l.output])).toEqual([
      ['codex|t1|105', 'gpt-5.3-codex', 60, 40, 5],
      ['codex|t1|105', 'gpt-5.3-codex', 60, 40, 5],
      ['codex|t1|320', 'gpt-5.3-codex', 200, 0, 15],
    ]);
  });
});
