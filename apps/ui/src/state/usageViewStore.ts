import { create } from 'zustand';
import type { UsagePeriod } from '@seshboard/protocol/client';
import type { UsageViewGroup } from '../components/usage/usageMerge.ts';
import { showInMain } from './popoutsStore.ts';
import { useProfiles } from './profilesStore.ts';
import { useSessions, type MainView } from './sessionsStore.ts';
import { backTarget, readRemembered, type Remembered, type UsageComputers, type UsageTab } from './usageViewPrefs.ts';

export type { UsageComputers, UsageTab } from './usageViewPrefs.ts';

const STORAGE_KEY = 'switchboard.usage.view';

/** The tab, period and computers last used in this window, so the view opens where it was left. */
function remembered(): Remembered {
  try {
    return readRemembered(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readRemembered(null);
  }
}

function remember({ tab, period, computers }: Remembered): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, period, computers }));
  } catch {
    // Private storage can be full or off; the view still works, it just forgets.
  }
}

interface UsageViewState {
  /** The profile the view shows; null until it is opened. */
  profileId: string | null;
  tab: UsageTab;
  period: UsagePeriod;
  /** Whose tokens it counts; only asked while other computers are paired. */
  computers: UsageComputers;
  groupBy: UsageViewGroup;
  /** The view it was opened from: Back and Esc return there. */
  from: Exclude<MainView, 'usage' | 'settings'>;
  loaded: boolean;
  setProfile(profileId: string): void;
  setTab(tab: UsageTab): void;
  setPeriod(period: UsagePeriod): void;
  setComputers(computers: UsageComputers): void;
  setGroupBy(groupBy: UsageViewGroup): void;
}

export const useUsageView = create<UsageViewState>()((set, get) => ({
  profileId: null,
  tab: 'limits',
  period: 'window',
  computers: 'all',
  groupBy: 'session',
  from: 'session',
  loaded: false,
  setProfile: (profileId) => set({ profileId }),
  setTab: (tab) => {
    set({ tab });
    remember(get());
  },
  setPeriod: (period) => {
    set({ period });
    remember(get());
  },
  setComputers: (computers) => {
    // Computer rows only exist while other computers count.
    set((s) => ({ computers, ...(computers === 'this' && s.groupBy === 'computer' ? { groupBy: 'session' } : {}) }));
    remember(get());
  },
  setGroupBy: (groupBy) => set({ groupBy }),
}));

/** Opens the Usage view for a profile (the default one when left out), as a main view like Home. */
export function openUsage(profileId?: string | null): void {
  // A pop-out has no Usage view: the main window shows it.
  if (showInMain({ kind: 'usage', profileId: profileId ?? null })) return;
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
