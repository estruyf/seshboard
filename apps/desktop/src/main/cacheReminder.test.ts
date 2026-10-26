import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WARNING, type SessionHostInfo } from '@seshboard/protocol/client';
import { CacheReminder, REMIND_BEFORE_MS, reminderDue, type CacheReminderNotice, type CacheReminderPrefs } from './cacheReminder.ts';

const HOUR = 60 * 60_000;
const host = (patch: Partial<SessionHostInfo> = {}): SessionHostInfo => ({
  sessionId: 's1',
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

function setup(prefs: Partial<CacheReminderPrefs> = {}, remind?: (n: CacheReminderNotice) => void) {
  let now = 0;
  const timers: Array<{ run: () => void; at: number }> = [];
  const notices: CacheReminderNotice[] = [];
  const logged: Array<[string, unknown]> = [];
  const reminder = new CacheReminder({
    prefs: () => ({ contextWarning: DEFAULT_CONTEXT_WARNING, showCost: true, costCurrency: 'USD', locale: 'en-US', ...prefs }),
    remind: remind ?? ((n) => notices.push(n)),
    now: () => now,
    setTimer: (run, ms) => {
      timers.push({ run, at: now + ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => timers.splice((t as unknown as number) - 1, 1, { run: () => {}, at: Infinity }),
    log: (message, error) => logged.push([message, error]),
  });
  const advance = (to: number) => {
    now = to;
    for (const t of timers.filter((t) => t.at <= to)) {
      t.at = Infinity;
      t.run();
    }
  };
  return { reminder, notices, logged, advance };
}

describe('reminderDue', () => {
  it('comes five minutes before an hour-long cache lapses, for a large idle session', () => {
    expect(reminderDue(host({ cacheAt: 1_000 }), DEFAULT_CONTEXT_WARNING)).toBe(1_000 + HOUR - REMIND_BEFORE_MS);
  });

  it('counts tokens, not the share of the window', () => {
    expect(reminderDue(host({ contextTokens: 384_000, contextPercent: 38, contextMax: 1_000_000 }), DEFAULT_CONTEXT_WARNING)).not.toBeNull();
  });

  it('skips small, busy, five-minute and switched-off sessions', () => {
    expect(reminderDue(host({ contextTokens: 100_000, contextPercent: 10, contextMax: 1_000_000 }), DEFAULT_CONTEXT_WARNING)).toBeNull();
    expect(reminderDue(host({ state: 'running' }), DEFAULT_CONTEXT_WARNING)).toBeNull();
    expect(reminderDue(host({ cacheTtl: '5m' }), DEFAULT_CONTEXT_WARNING)).toBeNull();
    expect(reminderDue(host({ cacheAt: null }), DEFAULT_CONTEXT_WARNING)).toBeNull();
    expect(reminderDue(host(), { ...DEFAULT_CONTEXT_WARNING, notifyExpiry: false })).toBeNull();
    expect(reminderDue(host(), { ...DEFAULT_CONTEXT_WARNING, enabled: false })).toBeNull();
  });
});

describe('CacheReminder', () => {
  it('reminds once, with the size and what re-reading it costs', () => {
    const { reminder, notices, advance } = setup();
    reminder.onHost(host());
    advance(HOUR - REMIND_BEFORE_MS - 1);
    expect(notices).toEqual([]);
    advance(HOUR - REMIND_BEFORE_MS);
    // 400k tokens at Opus 5.5's $4 input, twice that for the hour-long cache.
    expect(notices).toEqual([{ sessionId: 's1', tokens: '400k', cost: '≈$3.20' }]);
    reminder.onHost(host({ queue: [] }));
    reminder.check();
    expect(notices).toHaveLength(1);
  });

  it('starts over when the cache is used again, and forgets a session that closed', () => {
    const { reminder, notices, advance } = setup({ showCost: false });
    reminder.onHost(host());
    reminder.onHost(host({ cacheAt: 30 * 60_000 }));
    advance(HOUR - REMIND_BEFORE_MS);
    expect(notices).toEqual([]);
    advance(90 * 60_000 - REMIND_BEFORE_MS);
    expect(notices).toEqual([{ sessionId: 's1', tokens: '400k', cost: null }]);
    reminder.onHost(host({ cacheAt: 2 * HOUR }));
    reminder.onHost(host({ cacheAt: 2 * HOUR, state: 'closed' }));
    advance(3 * HOUR);
    expect(notices).toHaveLength(1);
  });

  it("shows the cost in the system's locale when the app's locale is one Intl can't read", () => {
    // '' is what app.getLocale() returns in the Windows build, which ships no locale file for the language.
    for (const locale of ['', 'en_US', 'nl-BE.UTF-8']) {
      const { reminder, notices, logged, advance } = setup({ locale });
      reminder.onHost(host());
      advance(HOUR - REMIND_BEFORE_MS);
      expect(notices).toEqual([{ sessionId: 's1', tokens: '400k', cost: `≈${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(3.2)}` }]);
      expect(logged).toEqual([]);
    }
  });

  it('logs a reminder that fails instead of throwing from its timer, and still sends the next', () => {
    const error = new Error('broken');
    let sent = 0;
    const { reminder, logged, advance } = setup({}, () => {
      if (sent++ === 0) throw error;
    });
    reminder.onHost(host());
    expect(() => advance(HOUR - REMIND_BEFORE_MS)).not.toThrow();
    expect(logged).toEqual([['[main] cache reminder failed', error]]);
    reminder.onHost(host({ sessionId: 's2', cacheAt: 10 * 60_000 }));
    advance(HOUR + 5 * 60_000);
    expect(sent).toBe(2);
  });

  it('says nothing about a cache that lapsed while the computer slept', () => {
    const { reminder, notices, advance } = setup();
    reminder.onHost(host());
    advance(2 * HOUR);
    expect(notices).toEqual([]);
  });
});
