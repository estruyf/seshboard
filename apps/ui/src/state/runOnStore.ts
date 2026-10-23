import { create } from 'zustand';
import { loadRemoteDraft, remoteNewDraftKey } from './remoteDrafts.ts';
import { THIS_COMPUTER } from './remoteRows.ts';
import { newSessionTarget } from './runOn.ts';

const KEY = 'ui.runOn';

function readLast(): string {
  try {
    return localStorage.getItem(KEY) ?? THIS_COMPUTER;
  } catch {
    return THIS_COMPUTER;
  }
}

interface RunOnState {
  /** Where New session starts Claude now: `THIS_COMPUTER` or a paired computer's id. */
  target: string;
  /** The last choice in the switch, remembered across launches: the sidebar's + opens there while a prompt typed for it is unsent, ⌘N on this computer. */
  last: string;
  /** The project picked on each other computer, by computer id (its `projectId`). */
  projects: Readonly<Record<string, string>>;
  /** A choice in the switch (or the palette's New session on…): shown now, and remembered. */
  setTarget(target: string): void;
  /** Where New session opens: this computer (⌘N, and every other way in), or the last choice (`last`, the sidebar's +) when it has an unsent prompt. */
  openOn(where: 'here' | 'last'): void;
  setProject(computerId: string, projectId: string | null): void;
}

/** New session's Run on switch (docs/remote-access.md, Other computers). ⌘N always starts on this computer. */
export const useRunOn = create<RunOnState>()((set) => ({
  target: THIS_COMPUTER,
  last: readLast(),
  projects: {},
  setTarget: (target) => {
    try {
      localStorage.setItem(KEY, target);
    } catch {
      // Remembering is a convenience.
    }
    set({ target, last: target });
  },
  openOn: (where) =>
    set((s) => ({
      target: newSessionTarget(where, s.last, (computerId) => {
        const draft = loadRemoteDraft(remoteNewDraftKey(computerId));
        return !!draft.text.trim() || !!draft.fill;
      }),
    })),
  setProject: (computerId, projectId) =>
    set((s) => {
      const projects = { ...s.projects };
      if (projectId) projects[computerId] = projectId;
      else delete projects[computerId];
      return { projects };
    }),
}));
