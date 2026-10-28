import { useEffect } from 'react';
import { create } from 'zustand';
import type { CloneSettings } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';

interface CloneState {
  /** Settings › Projects › Clone from GitHub on this computer; null until the engine has said. */
  settings: CloneSettings | null;
  /**
   * A repository New session should clone (the palette's step, a link's Clone, the folder field): `start` clones at
   * once, as the person already said which one. New session takes it with `take`.
   */
  request: { url: string; start: boolean; seq: number } | null;
  /**
   * New session's clone form, kept here so it stays when Run on changes (the clone then runs on the computer picked):
   * the URL and the folder's name ('' for the repository's own). Null while the form is closed.
   */
  form: { url: string; name: string } | null;
  /** The sidebar's Clone from GitHub dialog is open. */
  dialog: boolean;
  setSettings(settings: CloneSettings): void;
  /** Opens New session with the clone form, filled in with `url` (empty: asks for one). */
  cloneInNewSession(url: string, options?: { start?: boolean }): void;
  take(): { url: string; start: boolean } | null;
  openForm(url?: string): void;
  editForm(change: Partial<{ url: string; name: string }>): void;
  closeForm(): void;
  showDialog(open: boolean): void;
}

export const useClone = create<CloneState>()((set, get) => ({
  settings: null,
  request: null,
  form: null,
  dialog: false,
  setSettings: (settings) => set({ settings }),
  cloneInNewSession: (url, options = {}) => {
    set((s) => ({ form: { url, name: '' }, request: { url, start: options.start ?? false, seq: (s.request?.seq ?? 0) + 1 } }));
    useSessions.getState().openNewSession();
  },
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
  openForm: (url = '') => set((s) => ({ form: s.form && !url ? s.form : { url, name: '' } })),
  editForm: (change) => set((s) => ({ form: { url: '', name: '', ...s.form, ...change } })),
  closeForm: () => set({ form: null, request: null }),
  showDialog: (dialog) => set({ dialog }),
}));

/** Whether Clone from GitHub's ways in show: its setting is on here. */
export const useCloneEnabled = () => useClone((s) => s.settings?.enabled ?? false);

/** Keeps the setting current, and the project list after a clone (from any window, phone or computer) added one. */
export function useCloneSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    void client.call('projects.cloneSettings', {}).then((settings) => useClone.getState().setSettings(settings), () => {});
    const offSettings = client.on('projects.cloneSettings', (settings) => useClone.getState().setSettings(settings));
    const offProgress = client.on('projects.cloneProgress', (progress) => {
      if (progress.state === 'done') useProjects.getState().reload();
    });
    return () => {
      offSettings();
      offProgress();
    };
  }, [client]);
}
