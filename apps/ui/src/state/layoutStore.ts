import { create } from 'zustand';

/**
 * The session's side panel, as the title bar's Tools panel button sees it: the leading pane's session view (not a
 * pop-out) sets it while it is on screen and clears it on the way out. Null where there is no panel (Home, Settings,
 * a project page).
 */
export const useLayout = create<{ toolsPanel: { shows: boolean; toggle(): void } | null }>()(() => ({ toolsPanel: null }));
