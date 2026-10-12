import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo } from '@switchboard/protocol/client';
import { emptyHistory } from './navHistory.ts';
import { goInHistory, startRecording, useNavHistory } from './navHistoryStore.ts';
import { openProject, useProjectPage } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';

// The engine connection needs the preload's window.switchboard; these tests only move between views.
vi.mock('../engine/useEngine.ts', () => ({ useEngineConnection: () => ({ status: 'connecting' }) }));

describe('goInHistory', () => {
  beforeEach(() => useSessions.setState({ view: 'session', mainId: null, splitId: null, activePane: 'main', selectedId: null }));
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
