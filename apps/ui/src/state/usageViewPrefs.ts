import type { UsagePeriod } from '@switchboard/protocol/client';
import type { MainView } from './sessionsStore.ts';

export type UsageTab = 'limits' | 'tokens';

const PERIODS: readonly UsagePeriod[] = ['window', 'day', 'week', 'month'];

/** The tab and period saved last time (JSON), or the defaults: Limits, current window. */
export function readRemembered(saved: string | null): { tab: UsageTab; period: UsagePeriod } {
  try {
    const value = JSON.parse(saved ?? '{}') as { tab?: unknown; period?: unknown };
    return {
      tab: value.tab === 'tokens' ? 'tokens' : 'limits',
      period: PERIODS.includes(value.period as UsagePeriod) ? (value.period as UsagePeriod) : 'window',
    };
  } catch {
    return { tab: 'limits', period: 'window' };
  }
}

/**
 * Where Back goes after opening Usage from `view`: that view, or where Usage was opened from before when it is
 * already open (or Settings sits over it).
 */
export function backTarget(view: MainView, previous: Exclude<MainView, 'usage' | 'settings'>): Exclude<MainView, 'usage' | 'settings'> {
  return view === 'usage' || view === 'settings' ? previous : view;
}
