import { create } from 'zustand';
import type { UsageGroup, UsagePeriod } from '@switchboard/protocol/client';
import { useProfiles } from './profilesStore.ts';
import { useSessions, type MainView } from './sessionsStore.ts';
import { backTarget, readRemembered, type UsageTab } from './usageViewPrefs.ts';

export type { UsageTab } from './usageViewPrefs.ts';

const STORAGE_KEY = 'switchboard.usage.view';

/** The tab and period last used in this window, so the view opens where it was left. */
function remembered(): { tab: UsageTab; period: UsagePeriod } {
  try {
    return readRemembered(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readRemembered(null);
  }
}

function remember(state: { tab: UsageTab; period: UsagePeriod }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private storage can be full or off; the view still works, it just forgets.
  }
}

interface UsageViewState {
  /** The profile the view shows; null until it is opened. */
  profileId: string | null;
  tab: UsageTab;
  period: UsagePeriod;
  groupBy: UsageGroup;
  /** The view it was opened from: Back and Esc return there. */
  from: Exclude<MainView, 'usage' | 'settings'>;
  loaded: boolean;
  setProfile(profileId: string): void;
  setTab(tab: UsageTab): void;
  setPeriod(period: UsagePeriod): void;
  setGroupBy(groupBy: UsageGroup): void;
}

export const useUsageView = create<UsageViewState>()((set, get) => ({
  profileId: null,
  tab: 'limits',
  period: 'window',
  groupBy: 'session',
  from: 'session',
  loaded: false,
  setProfile: (profileId) => set({ profileId }),
  setTab: (tab) => {
    set({ tab });
    remember({ tab, period: get().period });
  },
  setPeriod: (period) => {
    set({ period });
    remember({ tab: get().tab, period });
  },
  setGroupBy: (groupBy) => set({ groupBy }),
}));

/** Opens the Usage view for a profile (the default one when left out), as a main view like Home. */
export function openUsage(profileId?: string | null): void {
  const { view } = useSessions.getState();
  const state = useUsageView.getState();
  useUsageView.setState({
    profileId: profileId ?? useProfiles.getState().defaultId,
    from: backTarget(view, state.from),
    ...(state.loaded ? {} : { ...remembered(), loaded: true }),
  });
  useSessions.getState().setView('usage');
}

/** Back to the view Usage was opened from. */
export function closeUsage(): void {
  useSessions.getState().setView(useUsageView.getState().from);
}
