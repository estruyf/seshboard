import { describe, expect, it } from 'vitest';
import type { UsageLimit } from '@seshboard/protocol/client';
import { countdown, limitLabel, visibleLimits } from '../components/usageFormat.ts';

const limit = (overrides: Partial<UsageLimit>): UsageLimit => ({ kind: 'session', group: 'session', percent: 10, resetsAt: null, scope: null, severity: 'normal', isActive: false, ...overrides });

describe('usage band helpers', () => {
  it('labels windows like the stats mod', () => {
    expect(limitLabel(limit({}))).toBe('5h');
    expect(limitLabel(limit({ kind: 'weekly_all', group: 'weekly' }))).toBe('7d');
    expect(limitLabel(limit({ kind: 'weekly_scoped', group: 'weekly', scope: 'Fable' }))).toBe('7d · Fable');
  });
  it('formats countdowns', () => {
    const now = 0;
    expect(countdown(4 * 3600_000 + 3 * 60_000, now)).toBe('4h3m');
    expect(countdown(3 * 86400_000 + 3600_000, now)).toBe('3d1h');
    expect(countdown(12 * 60_000, now)).toBe('12m');
    expect(countdown(-5, now)).toBe('now');
  });
  it('shows the main windows always and scoped ones only once used', () => {
    const rows = [limit({}), limit({ kind: 'weekly_all', percent: 0 }), limit({ kind: 'weekly_scoped', percent: 0, scope: 'Fable' }), limit({ kind: 'weekly_scoped', percent: 4, scope: 'Opus' })];
    expect(visibleLimits(rows).map((r) => r.scope ?? r.kind)).toEqual(['session', 'weekly_all', 'Opus']);
  });
});
