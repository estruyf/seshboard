import type { UsagePeriod } from '@switchboard/protocol/client';
import type { MainView } from './sessionsStore.ts';

export type UsageTab = 'limits' | 'tokens';

/** Whose tokens the view counts: this computer's, or also the same account's on paired computers. */
export type UsageComputers = 'this' | 'all';

const PERIODS: readonly UsagePeriod[] = ['window', 'day', 'week', 'month'];

export interface Remembered {
  tab: UsageTab;
  period: UsagePeriod;
  computers: UsageComputers;
}

/** The tab, period and computers saved last time (JSON), or the defaults: Limits, current window, every computer. */
export function readRemembered(saved: string | null): Remembered {
  try {
    const value = JSON.parse(saved ?? '{}') as { tab?: unknown; period?: unknown; computers?: unknown };
    return {
      tab: value.tab === 'tokens' ? 'tokens' : 'limits',
      period: PERIODS.includes(value.period as UsagePeriod) ? (value.period as UsagePeriod) : 'window',
      computers: value.computers === 'this' ? 'this' : 'all',
    };
  } catch {
    return { tab: 'limits', period: 'window', computers: 'all' };
  }
}

/**
 * Where Back goes after opening Usage from `view`: that view, or where Usage was opened from before when it is
 * already open (or Settings sits over it).
 */
export function backTarget(view: MainView, previous: Exclude<MainView, 'usage' | 'settings'>): Exclude<MainView, 'usage' | 'settings'> {
  return view === 'usage' || view === 'settings' ? previous : view;
}
