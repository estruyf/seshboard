import { RAIL_ORDER, RAIL_TOOLS, type RailTool } from '@seshboard/protocol/bridge';
import { agentsToggleStep } from '../../state/agentsPanel.ts';
import { modPaneTab, type ModPaneTab, type RightTab } from '../ask/askWidth.ts';

/** A button on the rail: one of the session's tools, or a mod's pane. */
export type RailToolId = Exclude<RailTool, 'mods'> | ModPaneTab;
/** GitHub's id among the pinned apps: it opens the folder's page on GitHub, where the folder has a GitHub remote. */
export const RAIL_GITHUB = 'github';

/** An app pinned to the rail, by its editor id (or `RAIL_GITHUB`): a click opens the session's folder in it. */
export type RailAppId = `app:${string}`;
export type RailEntry = { kind: 'tool'; id: RailToolId } | { kind: 'app'; id: RailAppId } | { kind: 'divider' };

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
  /** The apps pinned to the rail that are installed, by editor id, while the session has a folder to open. */
  apps: readonly string[];
}

/** The rail's groups, top to bottom: what the session made, then questions about it, then the mods' panes, then the apps. */
const GROUPS: readonly (readonly Exclude<RailTool, 'mods'>[])[] = [
  ['changes', 'terminal', 'web', 'preview'],
  ['ask', 'agents', 'commands'],
];

/**
 * The rail's buttons in order, with a divider between groups. A tool that doesn't apply, or that the rail's menu hid, is
 * left out, not greyed; a divider with nothing on one side of it goes too. Each group's tools follow `order` (dragged).
 */
export function railEntries(available: RailAvailable, hidden: readonly RailTool[] = [], order: readonly RailTool[] = RAIL_ORDER): RailEntry[] {
  const shown = (tool: RailTool) => !hidden.includes(tool);
  const tool = (id: RailToolId): RailEntry => ({ kind: 'tool', id });
  const place = (id: RailTool) => order.indexOf(id);
  const groups: RailEntry[][] = [
    ...GROUPS.map((group) => [...group].sort((a, b) => place(a) - place(b)).filter((id) => available[id] && shown(id)).map(tool)),
    shown('mods') ? available.mods.map(modPaneTab).map(tool) : [],
    available.apps.map((id): RailEntry => ({ kind: 'app', id: `app:${id}` })),
  ];
  return groups.filter((group) => group.length > 0).flatMap((group, i) => [...(i > 0 ? [{ kind: 'divider' as const }] : []), ...group]);
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

/** Which group a button is in: it moves only among its own group. A mod's pane doesn't move (null). */
export function railGroup(id: RailToolId | RailAppId): string | null {
  if (id.startsWith('app:')) return 'apps';
  if (id.startsWith('mod:')) return null;
  return String(GROUPS.findIndex((group) => group.includes(id as Exclude<RailTool, 'mods'>)));
}

/** A dragged button lands only next to one of its own group. */
export const sameRailGroup = (a: RailToolId | RailAppId, b: RailToolId | RailAppId): boolean => {
  const group = railGroup(a);
  return group !== null && group === railGroup(b);
};

/** Where ⌥↑ (-1) or ⌥↓ (1) moves a button among the rail's `ids`; null at the end of its group. */
export function stepRailButton(ids: readonly (RailToolId | RailAppId)[], id: RailToolId | RailAppId, step: 1 | -1): number | null {
  const at = ids.indexOf(id);
  const next = ids[at + step];
  return at === -1 || !next || !sameRailGroup(id, next) ? null : at + step;
}

/** Puts `id` in `full` before `next`, or after `previous` when it ends up last. Items not on the rail keep their places. */
function placeNear<T>(full: readonly T[], id: T, next: T | undefined, previous: T | undefined): T[] {
  const rest = full.filter((item) => item !== id);
  const at = next !== undefined && rest.includes(next) ? rest.indexOf(next) : previous !== undefined && rest.includes(previous) ? rest.indexOf(previous) + 1 : -1;
  return at === -1 ? [...full] : [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The orders after a button moved to `to` among the rail's buttons `ids` (as `dropIndex` counts): the tools' order, with
 * the ones not on the rail now (hidden, or that don't apply) where they were, and the pinned apps'.
 */
export function moveRailButton(
  ids: readonly (RailToolId | RailAppId)[],
  id: RailToolId | RailAppId,
  to: number,
  current: { railOrder: readonly Exclude<RailTool, 'mods'>[]; railApps: readonly string[] },
): { railOrder: Exclude<RailTool, 'mods'>[]; railApps: string[] } {
  const moved = ids.filter((other) => other !== id);
  moved.splice(to, 0, id);
  const own = moved.filter((other) => sameRailGroup(id, other));
  const at = own.indexOf(id);
  if (id.startsWith('app:')) {
    const name = (app: RailAppId | RailToolId | undefined) => app?.slice(4);
    return { railOrder: [...current.railOrder], railApps: placeNear(current.railApps, id.slice(4), name(own[at + 1]), name(own[at - 1])) };
  }
  const tool = id as Exclude<RailTool, 'mods'>;
  return { railOrder: placeNear(current.railOrder, tool, own[at + 1] as typeof tool | undefined, own[at - 1] as typeof tool | undefined), railApps: [...current.railApps] };
}

/** The pinned apps after a check in the rail's menu: a new one goes at the bottom, a pinned one comes off. */
export const toggleRailApp = (apps: readonly string[], id: string): string[] => (apps.includes(id) ? apps.filter((a) => a !== id) : [...apps, id]);

/** The hidden tools after a check in the rail's menu: hidden again or shown again, in the rail's order. */
export const toggleRailTool = (hidden: readonly RailTool[], tool: RailTool): RailTool[] =>
  RAIL_TOOLS.filter((t) => (t === tool ? !hidden.includes(t) : hidden.includes(t)));
