import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProjectInfo, SessionSummary } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { withQuestions } from '../lib/questions.ts';
import { useSessions } from './sessionsStore.ts';
import { popoutSession } from './popoutsStore.ts';

const FILTER_KEY = 'ui.projectFilter';

interface ProjectsState {
  /** By folder: the engine's list, plus the quick questions folder (named Questions, never a project). */
  projects: Map<string, ProjectInfo>;
  /** The list as the engine sent it. */
  listed: ProjectInfo[];
  /** The scratch folder quick questions run in; null until the engine has said. */
  questionsDir: string | null;
  /** The first list has arrived. */
  loaded: boolean;
  /** Show only this project's sessions; null = all projects. */
  filter: string | null;
  archivedOpen: boolean;
  /** Bumped to ask for a reload after icon or project changes. */
  version: number;
  /** The Add project dialog is open. */
  adding: boolean;
  /** A folder the New session view should switch to when it opens (from the palette or the Projects view). */
  newSessionIn: string | null;
  /** ...and start in a new worktree there (a session header's "New worktree…"). */
  newSessionWorktree: boolean;
  /** A profile New session should pick for one session when it opens (Copilot is ready's Start a Copilot session). */
  newSessionProfile: string | null;
  setProjects(projects: ProjectInfo[]): void;
  setQuestionsDir(dir: string): void;
  setFilter(root: string | null): void;
  toggleArchived(): void;
  reload(): void;
  showAdd(open: boolean): void;
  startIn(root: string | null, options?: { worktree?: boolean }): void;
  startWith(profileId: string | null): void;
}

export const useProjects = create<ProjectsState>()((set) => ({
  projects: new Map(),
  listed: [],
  questionsDir: null,
  loaded: false,
  filter: null,
  archivedOpen: false,
  version: 0,
  adding: false,
  newSessionIn: null,
  newSessionWorktree: false,
  newSessionProfile: null,
  setProjects: (listed) => set((s) => ({ listed, projects: withQuestions(listed, s.questionsDir), loaded: true })),
  setQuestionsDir: (questionsDir) => set((s) => ({ questionsDir, projects: withQuestions(s.listed, questionsDir) })),
  setFilter: (filter) => set({ filter }),
  toggleArchived: () => set((s) => ({ archivedOpen: !s.archivedOpen })),
  reload: () => set((s) => ({ version: s.version + 1 })),
  showAdd: (adding) => set({ adding }),
  startIn: (newSessionIn, options = {}) => set({ newSessionIn, newSessionWorktree: options.worktree ?? false }),
  startWith: (newSessionProfile) => set({ newSessionProfile }),
}));

/**
 * The project folders of all sessions, as one string to compare. The sessions map is replaced only when
 * the list changes, so the key is rebuilt then and not on every live status update.
 */
let rootsCache: { sessions: Map<string, SessionSummary>; key: string } | null = null;
function rootsKeyOf(sessions: Map<string, SessionSummary>): string {
  if (rootsCache?.sessions !== sessions) rootsCache = { sessions, key: [...new Set([...sessions.values()].map((x) => x.projectRoot))].sort().join('\n') };
  return rootsCache.key;
}

/** Loads projects (with icons) whenever the set of project folders changes, and persists the filter. */
export function useProjectsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const rootsKey = useSessions((s) => rootsKeyOf(s.sessions));
  const version = useProjects((s) => s.version);
  const filter = useProjects((s) => s.filter);

  useEffect(() => {
    if (!client) return;
    void client.call('projects.list', {}).then(({ projects }) => useProjects.getState().setProjects(projects));
  }, [client, rootsKey, version]);

  // Where quick questions run (the engine makes the folder).
  useEffect(() => {
    if (!client) return;
    void client.call('questions.folder', {}).then(({ path }) => useProjects.getState().setQuestionsDir(path), () => {});
  }, [client]);

  // An import (in any window) can add, remove and reorder projects.
  useEffect(() => client?.on('settings.imported', () => useProjects.getState().reload()), [client]);

  // The sidebar's filter: a pop-out has no sidebar, and leaves it alone.
  useEffect(() => {
    if (!client || popoutSession) return;
    void client.call('appState.get', { key: FILTER_KEY }).then(({ value }) => {
      if (typeof value === 'string') useProjects.getState().setFilter(value);
    });
  }, [client]);

  useEffect(() => {
    if (client && !popoutSession) void client.call('appState.set', { key: FILTER_KEY, value: filter });
  }, [client, filter]);
}
