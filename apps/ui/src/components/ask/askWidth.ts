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

/** How the right side's panels are sized: a width you drag (`side`), or half the session area (`half`). */
export type PanelSizing = 'side' | 'half';

/**
 * The right panel's width: the dragged one, or at Half half of the session area `body` wide (conversation and panel
 * share it 50/50, and keep doing so as the window resizes). Before the area is measured, the dragged width.
 */
export function panelWidthFor(sizing: PanelSizing, side: number, body: number | null): number {
  if (sizing !== 'half' || body === null || !(body > 0)) return side;
  return Math.max(ASK_MIN_WIDTH, Math.floor(body / 2));
}

/** The width after a resize key: ← widens the panel (its edge is on the left), → narrows it. Null for other keys. */
export function askWidthForKey(key: string, width: number, windowWidth: number): number | null {
  const step = key === 'ArrowLeft' ? ASK_KEY_STEP : key === 'ArrowRight' ? -ASK_KEY_STEP : null;
  return step === null ? null : clampAskWidth(width + step, windowWidth);
}

/** The panels that can share the right side: the terminal joins them when it is docked there. */
export type PanelTab = 'files' | 'changes' | 'ask' | 'agents' | 'commands' | 'note' | 'web' | 'terminal';
/** A Claude Code mod's pane, by its id. */
export type ModPaneTab = `mod:${string}`;
/** A project's canvas (docs/canvases.md), by its id. */
export type CanvasTab = `canvas:${string}`;
export type RightTab = PanelTab | ModPaneTab | CanvasTab;
/** Their order as tabs (mods' panes go after Ask). */
export const RIGHT_TABS: readonly PanelTab[] = ['files', 'changes', 'ask', 'agents', 'commands', 'note', 'web', 'terminal'];

export const modPaneTab = (paneId: string): ModPaneTab => `mod:${paneId}`;
export const canvasTab = (canvasId: string): CanvasTab => `canvas:${canvasId}`;
/** The canvas id of a canvas's tab, or null for any other panel. */
export const canvasOfTab = (tab: RightTab | null): string | null => (tab?.startsWith('canvas:') ? tab.slice(7) : null);
/** The pane id of a mod's tab, or null for one of Seshboard's panels. */
export const paneOfTab = (tab: RightTab | null): string | null => (tab?.startsWith('mod:') ? tab.slice(4) : null);

/**
 * What the right side shows: nothing, one panel, or several as tabs with `tab` in front (the one picked last, or the
 * first open one when that isn't open). `open` lists the open panels in tab order; `modPanes` are the ids of the
 * mods' panes open in this session, which sit after Ask; `canvases` the ids of the canvases open in it, which go last.
 */
export function rightPanel(isOpen: Record<PanelTab, boolean>, tab: RightTab, modPanes: readonly string[] = [], canvases: readonly string[] = []): { tab: RightTab | null; tabs: boolean; open: RightTab[] } {
  const own = (id: PanelTab) => (isOpen[id] ? [id] : []);
  const open: RightTab[] = [...own('files'), ...own('changes'), ...own('ask'), ...modPanes.map(modPaneTab), ...own('agents'), ...own('commands'), ...own('note'), ...own('web'), ...own('terminal'), ...canvases.map(canvasTab)];
  return { tab: open.includes(tab) ? tab : (open[0] ?? null), tabs: open.length > 1, open };
}

/** A stored tab, or Changes for anything else. */
export const readTab = (value: string | null): RightTab =>
  value === 'files' || value === 'ask' || value === 'agents' || value === 'commands' || value === 'note' || value === 'web' || value === 'terminal' ? value : value && /^mod:[A-Za-z0-9_-]{1,64}$/.test(value) ? (value as ModPaneTab) : value && /^canvas:[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? (value as CanvasTab) : 'changes';
