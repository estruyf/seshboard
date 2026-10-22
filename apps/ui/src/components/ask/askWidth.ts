/** The Ask panel's width limits: room for a question bubble and an answer at the minimum, as Changes keeps for its list. */
export const ASK_DEFAULT_WIDTH = 380;
export const ASK_MIN_WIDTH = 300;
/** The most of the window the panel may take. */
export const ASK_MAX_SHARE = 0.7;
/** How far one ← or → press moves the panel's edge. */
export const ASK_KEY_STEP = 24;

/**
 * Rounds and clamps a dragged or stored width for a window `windowWidth` wide. Anything that isn't a finite number
 * falls back to the default; a window too small for the minimum still gets the minimum.
 */
export function clampAskWidth(width: number, windowWidth: number): number {
  const max = Math.max(ASK_MIN_WIDTH, Math.floor(windowWidth * ASK_MAX_SHARE));
  const value = Number.isFinite(width) && width > 0 ? width : ASK_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(value, ASK_MIN_WIDTH), max));
}

/** The width after a resize key: ← widens the panel (its edge is on the left), → narrows it. Null for other keys. */
export function askWidthForKey(key: string, width: number, windowWidth: number): number | null {
  const step = key === 'ArrowLeft' ? ASK_KEY_STEP : key === 'ArrowRight' ? -ASK_KEY_STEP : null;
  return step === null ? null : clampAskWidth(width + step, windowWidth);
}

/** The panels that can share the right side: the terminal joins them when it is docked there. */
export type PanelTab = 'changes' | 'ask' | 'agents' | 'commands' | 'preview' | 'terminal';
/** A Claude Code mod's pane, by its id. */
export type ModPaneTab = `mod:${string}`;
export type RightTab = PanelTab | ModPaneTab;
/** Their order as tabs (mods' panes go after Ask). */
export const RIGHT_TABS: readonly PanelTab[] = ['changes', 'ask', 'agents', 'commands', 'preview', 'terminal'];

export const modPaneTab = (paneId: string): ModPaneTab => `mod:${paneId}`;
/** The pane id of a mod's tab, or null for one of Switchboard's panels. */
export const paneOfTab = (tab: RightTab | null): string | null => (tab?.startsWith('mod:') ? tab.slice(4) : null);

/**
 * What the right side shows: nothing, one panel, or several as tabs with `tab` in front (the one picked last, or the
 * first open one when that isn't open). `open` lists the open panels in tab order; `modPanes` are the ids of the
 * mods' panes open in this session, which sit after Ask.
 */
export function rightPanel(isOpen: Record<PanelTab, boolean>, tab: RightTab, modPanes: readonly string[] = []): { tab: RightTab | null; tabs: boolean; open: RightTab[] } {
  const own = (id: PanelTab) => (isOpen[id] ? [id] : []);
  const open: RightTab[] = [...own('changes'), ...own('ask'), ...modPanes.map(modPaneTab), ...own('agents'), ...own('commands'), ...own('preview'), ...own('terminal')];
  return { tab: open.includes(tab) ? tab : (open[0] ?? null), tabs: open.length > 1, open };
}

/** A stored tab, or Changes for anything else. */
export const readTab = (value: string | null): RightTab =>
  value === 'ask' || value === 'agents' || value === 'commands' || value === 'preview' || value === 'terminal' ? value : value && /^mod:[A-Za-z0-9_-]{1,64}$/.test(value) ? (value as ModPaneTab) : 'changes';
