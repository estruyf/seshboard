import { readTab, type RightTab } from '../components/ask/askWidth.ts';
import type { SessionAsk } from './ask.ts';

/*
 * How a session's panels stand: which are open, the tab in front, what each one has on show. It travels with the
 * session when it moves between the main window and a pop-out (through main, in memory only). The sizes are left
 * out on purpose (the right side's width, the terminal's height, width and dock): they belong to the window, which
 * has its own room. Pure, so it can be tested; `sessionView.ts` reads and writes the stores with it.
 */

/** The Ask thread on screen: the latest one, an empty new one, or a given one. */
export type AskThreadView = 'latest' | 'new' | { id: string };

/** One session's panels. Plain data, so main can hand it from window to window. */
export interface SessionViewState {
  changes: boolean;
  ask: boolean;
  askThread: AskThreadView;
  agents: boolean;
  /** The agent on show (a tool call id). */
  agent: string | null;
  commands: boolean;
  /** The command on show (a task id). */
  command: string | null;
  /** The tab in front on the right side (also a mod's pane). */
  tab: RightTab;
  terminal: boolean;
  terminalMaximized: boolean;
  /** The terminal tab selected in the terminal panel. */
  terminalTab: string | null;
}

/** A panel with something picked in it (Agents, Commands). */
export interface PickedPanel {
  open: boolean;
  picked: string | null;
}

/** The parts of the stores a session's view is in, as plain data. */
export interface ViewSlices {
  changes: ReadonlySet<string>;
  ask: ReadonlyMap<string, SessionAsk>;
  agents: ReadonlyMap<string, PickedPanel>;
  commands: ReadonlyMap<string, PickedPanel>;
  /** The tab each session picked. */
  tabs: ReadonlyMap<string, RightTab>;
  /** The tab picked last in the window, for sessions that picked none. */
  tab: RightTab;
  terminalOpen: ReadonlySet<string>;
  terminalMaximized: ReadonlySet<string>;
  terminalTab: ReadonlyMap<string, string>;
}

const emptyAsk = (): Pick<SessionAsk, 'open' | 'threadId'> => ({ open: false, threadId: undefined });

/** Reads a session's view from the stores' state. */
export function collectView(sessionId: string, slices: ViewSlices): SessionViewState {
  const ask = slices.ask.get(sessionId) ?? emptyAsk();
  const agents = slices.agents.get(sessionId);
  const commands = slices.commands.get(sessionId);
  const open = slices.terminalOpen.has(sessionId);
  return {
    changes: slices.changes.has(sessionId),
    ask: ask.open,
    askThread: ask.threadId === undefined ? 'latest' : ask.threadId === null ? 'new' : { id: ask.threadId },
    agents: agents?.open ?? false,
    agent: agents?.picked ?? null,
    commands: commands?.open ?? false,
    command: commands?.picked ?? null,
    tab: slices.tabs.get(sessionId) ?? slices.tab,
    terminal: open,
    terminalMaximized: open && slices.terminalMaximized.has(sessionId),
    terminalTab: slices.terminalTab.get(sessionId) ?? null,
  };
}

/** The set with a member in or out; the same set when it already is. */
function withMember(set: ReadonlySet<string>, member: string, present: boolean): ReadonlySet<string> {
  if (set.has(member) === present) return set;
  const next = new Set(set);
  if (present) next.add(member);
  else next.delete(member);
  return next;
}

/** The map with an entry set (or, with null, gone); the same map when it already is that. */
function withEntry<T>(map: ReadonlyMap<string, T>, key: string, value: T | null, same: (a: T, b: T) => boolean): ReadonlyMap<string, T> {
  const before = map.get(key);
  if (value === null ? before === undefined : before !== undefined && same(before, value)) return map;
  const next = new Map(map);
  if (value === null) next.delete(key);
  else next.set(key, value);
  return next;
}

/**
 * The stores' state with a session's view put in: only that session's entries change, and a part that already
 * stands as the view says is returned as it was (so the stores it belongs to need no update).
 */
export function applyView(sessionId: string, view: SessionViewState, slices: ViewSlices): ViewSlices {
  const before = slices.ask.get(sessionId);
  const threadId = view.askThread === 'latest' ? undefined : view.askThread === 'new' ? null : view.askThread.id;
  const ask =
    (before?.open ?? false) === view.ask && (before ? before.threadId : undefined) === threadId
      ? slices.ask
      : new Map(slices.ask).set(sessionId, { ...(before ?? { threads: [], loaded: false, ready: false }), open: view.ask, threadId, ready: view.ask ? false : (before?.ready ?? false) });
  // A panel that was never opened and stays closed gets no entry.
  const picked = (map: ReadonlyMap<string, PickedPanel>, open: boolean, pick: string | null) =>
    !open && pick === null && !map.has(sessionId) ? map : withEntry(map, sessionId, { open, picked: pick }, (a, b) => a.open === b.open && a.picked === b.picked);
  // A terminal's open order is "last opened at the end": a panel that opens goes to the end.
  const terminalOpen = view.terminal === slices.terminalOpen.has(sessionId) ? slices.terminalOpen : withMember(withMember(slices.terminalOpen, sessionId, false), sessionId, view.terminal);
  return {
    changes: withMember(slices.changes, sessionId, view.changes),
    ask,
    agents: picked(slices.agents, view.agents, view.agent),
    commands: picked(slices.commands, view.commands, view.command),
    // A session that picked no tab keeps following the window's, when that is the tab it was left on.
    tabs: !slices.tabs.has(sessionId) && view.tab === slices.tab ? slices.tabs : withEntry(slices.tabs, sessionId, view.tab, (a, b) => a === b),
    tab: slices.tab,
    terminalOpen,
    terminalMaximized: withMember(slices.terminalMaximized, sessionId, view.terminal && view.terminalMaximized),
    terminalTab: view.terminalTab === null ? slices.terminalTab : withEntry(slices.terminalTab, sessionId, view.terminalTab, (a, b) => a === b),
  };
}

export function sameView(a: SessionViewState, b: SessionViewState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
const isText = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length > 0 && value.length < 500);

/** A view that arrived from another window, or null when it isn't one (a newer or older shape: the panels stay as they are). */
export function parseView(value: unknown): SessionViewState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isFlag(v.changes) || !isFlag(v.ask) || !isFlag(v.agents) || !isFlag(v.commands) || !isFlag(v.terminal) || !isFlag(v.terminalMaximized)) return null;
  if (!isText(v.agent) || !isText(v.command) || !isText(v.terminalTab) || typeof v.tab !== 'string') return null;
  const thread = v.askThread;
  const askThread: AskThreadView | null =
    thread === 'latest' || thread === 'new'
      ? thread
      : thread && typeof thread === 'object' && typeof (thread as { id?: unknown }).id === 'string' && (thread as { id: string }).id
        ? { id: (thread as { id: string }).id }
        : null;
  if (!askThread) return null;
  return {
    changes: v.changes,
    ask: v.ask,
    askThread,
    agents: v.agents,
    agent: v.agent,
    commands: v.commands,
    command: v.command,
    tab: readTab(v.tab),
    terminal: v.terminal,
    terminalMaximized: v.terminalMaximized,
    terminalTab: v.terminalTab,
  };
}
