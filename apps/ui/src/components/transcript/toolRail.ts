import { RAIL_TOOLS, type RailTool } from '@seshboard/protocol/bridge';
import { agentsToggleStep } from '../../state/agentsPanel.ts';
import { modPaneTab, type ModPaneTab, type RightTab } from '../ask/askWidth.ts';

/** A button on the rail: one of the session's tools, or a mod's pane. */
export type RailToolId = Exclude<RailTool, 'mods'> | ModPaneTab;
export type RailEntry = { kind: 'tool'; id: RailToolId } | { kind: 'divider' };

/** Which tools apply to the session now (a git repository, the browser allowed, a file to preview, a mod's panes). */
export interface RailAvailable {
  changes: boolean;
  terminal: boolean;
  web: boolean;
  preview: boolean;
  ask: boolean;
  agents: boolean;
  commands: boolean;
  /** The ids of the mods' panes open in the session. */
  mods: readonly string[];
}

/** The rail's groups, top to bottom: what the session made, then questions about it, then the mods' panes. */
const GROUPS: readonly (readonly Exclude<RailTool, 'mods'>[])[] = [
  ['changes', 'terminal', 'web', 'preview'],
  ['ask', 'agents', 'commands'],
];

/**
 * The rail's buttons in order, with a divider between groups. A tool that doesn't apply, or that the rail's menu hid, is
 * left out, not greyed; a divider with nothing on one side of it goes too.
 */
export function railEntries(available: RailAvailable, hidden: readonly RailTool[] = []): RailEntry[] {
  const shown = (tool: RailTool) => !hidden.includes(tool);
  const groups: RailToolId[][] = [...GROUPS.map((group) => group.filter((tool) => available[tool] && shown(tool))), shown('mods') ? available.mods.map(modPaneTab) : []];
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, i) => [...(i > 0 ? [{ kind: 'divider' as const }] : []), ...group.map((id) => ({ kind: 'tool' as const, id }))]);
}

/** Where a tool stands: in front on the right side (or the terminal shown below), open behind another, or closed. */
export type RailToolState = 'front' | 'behind' | 'closed';

export function railToolState(id: RailToolId, open: readonly RightTab[], front: RightTab | null): RailToolState {
  if (!open.includes(id)) return 'closed';
  return front === id ? 'front' : 'behind';
}

/** What a click does, as the header's buttons did: a closed tool opens in front, one behind comes to the front, the one in front closes. */
export const railStep = (state: RailToolState, othersOpen: boolean): 'open' | 'front' | 'close' => agentsToggleStep(state !== 'closed', state === 'front', othersOpen);

/** What each tool's badge counts, for its label. */
export interface RailCounts {
  changes?: number;
  terminal?: number;
  web?: number;
  agents?: number;
  commands?: number;
}

const NAMES: Record<Exclude<RailTool, 'mods'>, string> = { changes: 'Changes', terminal: 'Terminal', web: 'Browser', preview: 'Preview', ask: 'Ask', agents: 'Agents', commands: 'Commands' };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What the badge says in words: "3 files", "2 tabs", "1 running". Null with nothing to count. */
export function railCountText(id: RailToolId, counts: RailCounts): string | null {
  const count = id in counts ? (counts[id as keyof RailCounts] ?? 0) : 0;
  if (count <= 0) return null;
  if (id === 'changes') return plural(count, 'file', 'files');
  if (id === 'web') return plural(count, 'tab', 'tabs');
  return `${count} running`;
}

/**
 * A tool's name with what is in it: the tooltip ("Changes · 3 files") and, joined with a comma, its accessible name
 * ("Changes, 3 files"). `name` overrides the tool's own (a mod's pane, Web while the browser is off).
 */
export function railLabel(id: RailToolId, counts: RailCounts, options: { name?: string; separator?: string } = {}): string {
  const name = options.name ?? (id.startsWith('mod:') ? id.slice(4) : NAMES[id as Exclude<RailTool, 'mods'>]);
  const text = railCountText(id, counts);
  return text ? `${name}${options.separator ?? ' · '}${text}` : name;
}

/** The tools the rail's menu lists, each to show or hide. */
export const RAIL_MENU: readonly { tool: RailTool; label: string }[] = RAIL_TOOLS.map((tool) => ({ tool, label: tool === 'mods' ? 'Mods' : NAMES[tool] }));

/** The hidden tools after a check in the rail's menu: hidden again or shown again, in the rail's order. */
export const toggleRailTool = (hidden: readonly RailTool[], tool: RailTool): RailTool[] =>
  RAIL_TOOLS.filter((t) => (t === tool ? !hidden.includes(t) : hidden.includes(t)));
