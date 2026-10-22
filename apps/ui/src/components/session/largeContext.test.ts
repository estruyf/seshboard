import { describe, expect, it } from 'vitest';
import { cacheRewriteCost, DEFAULT_CONTEXT_WARNING, type ModelOption, type SessionHostInfo, type TranscriptMessage } from '@switchboard/protocol/client';
import { agoText, cacheState, cacheUseOf, contextLevel, largeSessions, largeSessionsText, nextMessageModel, transcriptCache, untilText } from './largeContext.ts';

const HOUR = 60 * 60_000;
const reply = (at: number, usage: Partial<NonNullable<TranscriptMessage['usage']>> | null, patch: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  uuid: `m${at}`,
  role: 'assistant',
  timestamp: at,
  parentToolUseId: null,
  model: 'claude-opus-5-5',
  blocks: [],
  usage: usage && { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ...usage },
  ...patch,
});
const host = (patch: Partial<SessionHostInfo>): SessionHostInfo => ({
  sessionId: 's',
  cwd: '/p',
  state: 'idle',
  model: 'claude-opus-5-5',
  permissionMode: 'default',
  effort: null,
  costUsd: 0,
  contextPercent: 80,
  contextTokens: 400_000,
  contextMax: 500_000,
  cacheAt: 0,
  cacheTtl: '1h',
  error: null,
  startedAt: 0,
  promptedAt: null,
  queue: [],
  queueHold: null,
  profileId: 'default',
  backgroundTasks: [],
  ...patch,
});

describe('contextLevel', () => {
  it('turns orange from the large token count and red from 85% of the window', () => {
    const at70 = { ...DEFAULT_CONTEXT_WARNING, percent: 70 };
    expect(contextLevel(60, 119_000, at70)).toBe('ok');
    expect(contextLevel(60, 140_000, at70)).toBe('caution');
    expect(contextLevel(85, 850_000, at70)).toBe('high');
  });

  it('is orange for 384k on a 1M window, and not for 100k', () => {
    expect(contextLevel(38, 384_000, DEFAULT_CONTEXT_WARNING)).toBe('caution');
    expect(contextLevel(10, 100_000, DEFAULT_CONTEXT_WARNING)).toBe('ok');
  });

  it('goes straight to red when the percentage is past 85%, and keeps the usual levels when off', () => {
    expect(contextLevel(88, 880_000, { ...DEFAULT_CONTEXT_WARNING, percent: 90 })).toBe('caution');
    expect(contextLevel(90, 180_000, { ...DEFAULT_CONTEXT_WARNING, percent: 90 })).toBe('high');
    expect(contextLevel(65, 130_000, { ...DEFAULT_CONTEXT_WARNING, enabled: false, percent: 90 })).toBe('caution');
  });
});

describe('transcriptCache', () => {
  it('takes the last reply that used the cache, and the cache it last wrote to', () => {
    const messages = [reply(1_000, { cacheCreation: 500, cacheTtl: '1h' }), reply(2_000, { cacheRead: 500 }), reply(3_000, null), reply(4_000, { cacheRead: 9 }, { parentToolUseId: 'agent' })];
    expect(transcriptCache(messages)).toEqual({ at: 2_000, ttl: '1h' });
  });

  it('is unknown when no reply says which cache', () => {
    expect(transcriptCache([reply(1_000, { cacheRead: 500 })])).toBeNull();
  });
});

describe('cacheUseOf', () => {
  it('takes the running session’s report when it is newer than the transcript', () => {
    const messages = [reply(1_000, { cacheCreation: 5, cacheTtl: '5m' })];
    expect(cacheUseOf(host({ cacheAt: 2_000, cacheTtl: '1h' }), messages)).toEqual({ at: 2_000, ttl: '1h' });
    expect(cacheUseOf(host({ cacheAt: 500, cacheTtl: '1h' }), messages)).toEqual({ at: 1_000, ttl: '5m' });
    expect(cacheUseOf(undefined, messages)).toEqual({ at: 1_000, ttl: '5m' });
  });
});

describe('cacheState', () => {
  it('is warm until the cache lapses, then cold', () => {
    expect(cacheState({ at: 0, ttl: '1h' }, HOUR - 1)).toEqual({ kind: 'warm', expiresAt: HOUR });
    expect(cacheState({ at: 0, ttl: '1h' }, HOUR)).toEqual({ kind: 'cold', since: HOUR });
    expect(cacheState(null, 0)).toEqual({ kind: 'unknown' });
  });

  it('says how long, in words', () => {
    expect(untilText(30_000)).toBe('under a minute');
    expect(untilText(48 * 60_000 + 59_000)).toBe('48 min');
    expect(agoText(14 * HOUR)).toBe('14 h');
    expect(agoText(72 * HOUR)).toBe('3 days');
  });
});

describe('largeSessions', () => {
  it('lists the open sessions past the percentage, largest first, with what reading them again costs', () => {
    const hosts = [
      host({ sessionId: 'a', contextTokens: 300_000, contextPercent: 60 }),
      host({ sessionId: 'b', contextTokens: 400_000, contextPercent: 80, cacheTtl: null }),
      host({ sessionId: 'small', contextTokens: 100_000, contextPercent: 20 }),
      host({ sessionId: 'wide', contextTokens: 100_000, contextPercent: 10, contextMax: 1_000_000 }),
      host({ sessionId: 'closed', state: 'closed' }),
    ];
    expect(largeSessions(hosts, DEFAULT_CONTEXT_WARNING, cacheRewriteCost)).toEqual([
      { sessionId: 'b', tokens: 400_000, ttl: null, usd: null },
      { sessionId: 'a', tokens: 300_000, ttl: '1h', usd: 2.4 },
    ]);
  });

  it('reads as one sentence', () => {
    const dollars = (usd: number) => `≈$${usd.toFixed(2)}`;
    expect(largeSessionsText([{ sessionId: 'a', tokens: 412_000, ttl: '1h', usd: 3.3 }], dollars)).toBe(
      'One open session has a large context (412k tokens). Its cache lapses within the hour, so picking it up later reads all of it again (≈$3.30).',
    );
    expect(
      largeSessionsText(
        [
          { sessionId: 'a', tokens: 412_000, ttl: '5m', usd: 3 },
          { sessionId: 'b', tokens: 180_000, ttl: null, usd: null },
        ],
        null,
      ),
    ).toBe('2 open sessions have a large context (412k and 180k tokens). Their caches lapse within minutes, so picking them up later reads all of it again.');
    expect(largeSessionsText([], null)).toBeNull();
  });
});

describe('nextMessageModel', () => {
  const option = (value: string, resolvedModel: string): ModelOption => ({ value, displayName: value, description: '', resolvedModel, supportsEffort: false });
  const models = [option('default', 'claude-opus-5-5'), option('sonnet', 'claude-sonnet-5-5'), option('opus', 'claude-opus-5-5')];

  it('resolves an alias to the model it stands for', () => {
    expect(nextMessageModel('sonnet', models, ['claude-opus-5-5'])).toBe('claude-sonnet-5-5');
  });

  it('takes null as the default model', () => {
    expect(nextMessageModel(null, [option('default', 'claude-sonnet-5-5'), option('opus', 'claude-opus-5-5')], ['claude-opus-5-5'])).toBe('claude-sonnet-5-5');
  });

  it('skips an unknown choice and uses the first priceable fallback', () => {
    expect(nextMessageModel(undefined, models, [null, undefined, '', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5');
  });

  it('falls through when the choice cannot be priced', () => {
    expect(nextMessageModel('default', [], ['claude-opus-5-5'])).toBe('claude-opus-5-5');
  });

  it('passes a full id through', () => {
    expect(nextMessageModel('claude-sonnet-5-5', models, ['claude-opus-5-5'])).toBe('claude-sonnet-5-5');
  });

  it('is null when nothing can be priced', () => {
    expect(nextMessageModel('default', [], [null, 'mystery'])).toBeNull();
  });
});
