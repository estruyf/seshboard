import { create } from 'zustand';
import { useSessions } from './sessionsStore.ts';

/** The tabs of a project's page, in order. */
export type ProjectTab = 'overview' | 'sessions' | 'worktrees' | 'branches' | 'memory' | 'actions' | 'settings';
export const PROJECT_TABS: readonly ProjectTab[] = ['overview', 'sessions', 'worktrees', 'branches', 'memory', 'actions', 'settings'];

interface ProjectPageState {
  /** The project the page shows (the view is `project` while it's on screen). */
  root: string | null;
  tab: ProjectTab;
  /** The tab each project was last left on, while the app runs. */
  lastTab: Map<string, ProjectTab>;
  /**
   * A project whose Worktrees tab should open the clean-up confirmation for the suggested worktrees once its list is
   * read (the palette's "Clean up worktrees in …"). The tab clears it.
   */
  pendingCleanup: string | null;
  setTab(tab: ProjectTab): void;
  clearCleanup(): void;
}

export const useProjectPage = create<ProjectPageState>()((set) => ({
  root: null,
  tab: 'overview',
  lastTab: new Map(),
  pendingCleanup: null,
  setTab: (tab) =>
    set((s) => {
      if (!s.root) return { tab };
      const lastTab = new Map(s.lastTab);
      lastTab.set(s.root, tab);
      return { tab, lastTab };
    }),
  clearCleanup: () => set({ pendingCleanup: null }),
}));

/** Opens a project's page, on `tab` or the one it was last left on (Overview the first time). */
export function openProject(root: string, tab?: ProjectTab): void {
  useProjectPage.setState((s) => {
    const next = tab ?? s.lastTab.get(root) ?? 'overview';
    const lastTab = new Map(s.lastTab);
    lastTab.set(root, next);
    return { root, tab: next, lastTab };
  });
  useSessions.getState().setView('project');
}

/** Opens a project's Worktrees tab with the clean-up confirmation for the suggested worktrees. */
export function cleanUpWorktrees(root: string): void {
  useProjectPage.setState({ pendingCleanup: root });
  openProject(root, 'worktrees');
}
