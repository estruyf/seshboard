import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, SessionSummary } from '@seshboard/protocol/client';
import { emptyHistory } from './navHistory.ts';
import { goInHistory, startRecording, useNavHistory } from './navHistoryStore.ts';
import { openProject, useProjectPage } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { openUsage, useUsageView } from './usageViewStore.ts';

// The engine connection needs the preload's window.seshboard; these tests only move between views.
vi.mock('../engine/useEngine.ts', () => ({ useEngineConnection: () => ({ status: 'connecting' }) }));

describe('goInHistory', () => {
  beforeEach(() => useSessions.setState({ view: 'session', layout: null, paneIds: [], selectedId: null }));
  afterEach(() => {
    vi.useRealTimers();
    useNavHistory.setState({ history: emptyHistory });
  });

  it('goes from a project back to the Settings page that opened it, and forward again', () => {
    vi.useFakeTimers();
    useProjects.setState({ projects: new Map([['/p', { root: '/p' } as ProjectInfo]]) });
    const stop = startRecording();
    vi.advanceTimersByTime(1000);
    useSessions.getState().openSettings('memory');
    vi.advanceTimersByTime(1000);
    openProject('/p', 'memory');
    vi.advanceTimersByTime(1000);

    goInHistory(-1);
    expect(useSessions.getState()).toMatchObject({ view: 'settings', settingsSection: 'memory' });
    goInHistory(1);
    expect(useSessions.getState().view).toBe('project');
    expect(useProjectPage.getState()).toMatchObject({ root: '/p', tab: 'memory' });
    // Going back and forward added nothing.
    expect(useNavHistory.getState().history.entries).toHaveLength(3);
    stop();
  });

  it('comes back to the Usage view of the same profile', () => {
    vi.useFakeTimers();
    const stop = startRecording();
    vi.advanceTimersByTime(1000);
    openUsage('work');
    vi.advanceTimersByTime(1000);
    useSessions.getState().goHome();
    vi.advanceTimersByTime(1000);

    goInHistory(-1);
    expect(useSessions.getState().view).toBe('usage');
    expect(useUsageView.getState().profileId).toBe('work');
    stop();
  });

  it('brings back the panes that were open, leaving out sessions that are gone', () => {
    vi.useFakeTimers();
    const summary = (id: string) => [id, { id } as SessionSummary] as const;
    useSessions.setState({ sessions: new Map([summary('a'), summary('b'), summary('c')]), live: new Map() });
    const stop = startRecording();
    vi.advanceTimersByTime(1000);
    useSessions.getState().select('a');
    useSessions.getState().openBeside('b');
    useSessions.getState().openBeside('c');
    useSessions.getState().focusPane('b');
    vi.advanceTimersByTime(1000);
    openUsage(null);
    vi.advanceTimersByTime(1000);
    useSessions.setState({ sessions: new Map([summary('a'), summary('c')]) });

    goInHistory(-1);
    const state = useSessions.getState();
    expect(state.view).toBe('session');
    expect(state.paneIds).toEqual(['a', 'c']);
    // The active pane's session is gone, so another pane is.
    expect(state.selectedId).toBe('a');
    stop();
    useSessions.setState({ sessions: new Map() });
  });

  it('skips a project that is gone', () => {
    vi.useFakeTimers();
    useProjects.setState({ projects: new Map([['/gone', { root: '/gone' } as ProjectInfo]]) });
    const stop = startRecording();
    vi.advanceTimersByTime(1000);
    openProject('/gone');
    vi.advanceTimersByTime(1000);
    useSessions.getState().openSettings('general');
    vi.advanceTimersByTime(1000);
    useProjects.setState({ projects: new Map() });

    goInHistory(-1);
    expect(useSessions.getState().view).toBe('session');
    stop();
  });
});
