import { useEffect } from 'react';
import { create } from 'zustand';
import type { TerminalInfo, TerminalKind } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { clampPanelHeight, clampPanelWidth, PANEL_DEFAULT_HEIGHT, PANEL_DEFAULT_WIDTH, parseDock, type TerminalDock } from '../components/terminal/terminalLayout.ts';
import { trackRuns, type RunTimes } from '../components/terminal/terminalStatus.ts';
import { ownerSession } from '../components/terminal/appTerminal.ts';
import { ENGINE_RESTARTED_MESSAGE, panelsWithLostTerminals } from '../components/terminal/lostTerminals.ts';
import { runOnce } from '../lib/inFlight.ts';
import { passFocusGate } from './focusGate.ts';
import { popoutSession } from './popoutsStore.ts';

const PANEL_KEY = 'ui.terminalPanel';

/** The code of the notice that says an engine restart closed a panel's terminals (not one of the engine's). */
export const ENGINE_RESTARTED = 'ENGINE_RESTARTED';

/**
 * Why a terminal didn't open (or went away), shown in the panel. `code` is the engine's (e.g. SESSION_RUNNING_HERE), so
 * the panel can offer a way out, or `ENGINE_RESTARTED`.
 */
export interface TerminalNotice {
  code: string | null;
  message: string;
}

/**
 * Panels are keyed by their owner: a session's id, or `APP_TERMINAL` for the window's own terminal (outside
 * sessions). Everything kept per panel below uses that key.
 */
interface TerminalsState {
  terminals: Map<string, TerminalInfo>;
  /** The engine's list has arrived, so "no terminals" really means none. */
  loaded: boolean;
  /** Panels that are shown: each session view has its own, so it stays with the view it was opened in, and the other views share the window's. */
  openFor: Set<string>;
  /** The panel the user just opened (Terminal button, ⌘J): it starts a shell when it has no terminals. */
  shellWanted: string | null;
  /** Docked below: its height. */
  panelHeight: number;
  /** Docked right: its width. */
  panelWidth: number;
  /** Where the user wants the panel. It still docks below while the Changes panel is on the right (`effectiveDock`). */
  dock: TerminalDock;
  /** Panels that take the whole view, hiding the conversation or view under them (⌘⇧J; Esc or ⌘⇧J restores it). */
  maximizedFor: Set<string>;
  /** When each terminal's current run started and ended, for the run strip's elapsed time. */
  runs: Map<string, RunTimes>;
  /** Selected tab per panel. */
  active: Map<string, string>;
  /** Per panel. */
  notices: Map<string, TerminalNotice>;
  setTerminals(list: TerminalInfo[]): void;
  /** A panel. No `open`: the user toggles it, and opening asks for a shell. `true`/`false`: show or hide what's there (an action's tab). */
  togglePanel(sessionId: string, open?: boolean): void;
  /** Restores the sessions whose panel was open when the app last closed. */
  restoreOpen(sessionIds: string[]): void;
  /** The panel has started its shell (or didn't need one). */
  clearShellWanted(): void;
  setNotice(sessionId: string, notice: TerminalNotice | null): void;
  setPanelHeight(height: number): void;
  setPanelWidth(width: number): void;
  setDock(dock: TerminalDock): void;
  /** No `maximized`: toggle. */
  setMaximized(sessionId: string, maximized?: boolean): void;
  setActive(sessionId: string, terminalId: string): void;
}

export const useTerminals = create<TerminalsState>()((set) => ({
  terminals: new Map(),
  loaded: false,
  openFor: new Set(),
  shellWanted: null,
  panelHeight: PANEL_DEFAULT_HEIGHT,
  panelWidth: PANEL_DEFAULT_WIDTH,
  dock: 'bottom',
  maximizedFor: new Set(),
  runs: new Map(),
  active: new Map(),
  notices: new Map(),
  setTerminals: (list) => set((s) => ({ terminals: new Map(list.map((t) => [t.id, t])), runs: trackRuns(s.runs, s.terminals, list, Date.now()), loaded: true })),
  // Hiding the panel also ends a maximized view, so the conversation is back the next time.
  togglePanel: (sessionId, open) =>
    set((s) => {
      const next = open ?? !s.openFor.has(sessionId);
      if (next === s.openFor.has(sessionId) && open !== undefined) return {};
      const openFor = new Set(s.openFor);
      // Last opened at the end: only the most recent ones are remembered.
      openFor.delete(sessionId);
      if (next) openFor.add(sessionId);
      const maximizedFor = new Set(s.maximizedFor);
      if (!next) maximizedFor.delete(sessionId);
      const shellWanted = open === undefined ? (next ? sessionId : null) : s.shellWanted;
      return { openFor, maximizedFor, shellWanted };
    }),
  restoreOpen: (sessionIds) => set((s) => ({ openFor: new Set([...sessionIds, ...s.openFor]) })),
  clearShellWanted: () => set({ shellWanted: null }),
  setNotice: (sessionId, notice) =>
    set((s) => {
      const notices = new Map(s.notices);
      if (notice) notices.set(sessionId, notice);
      else notices.delete(sessionId);
      return { notices };
    }),
  setPanelHeight: (height) => set({ panelHeight: clampPanelHeight(height, window.innerHeight) }),
  setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width, window.innerWidth) }),
  setDock: (dock) => set({ dock }),
  setMaximized: (sessionId, maximized) =>
    set((s) => {
      const next = maximized ?? !s.maximizedFor.has(sessionId);
      if (next === s.maximizedFor.has(sessionId)) return {};
      const maximizedFor = new Set(s.maximizedFor);
      if (next) maximizedFor.add(sessionId);
      else maximizedFor.delete(sessionId);
      return { maximizedFor };
    }),
  setActive: (sessionId, terminalId) => set((s) => ({ active: new Map(s.active).set(sessionId, terminalId) })),
}));

/**
 * Opens a terminal tab in a panel (a session's, or the window's own with `APP_TERMINAL`) and shows it. When it
 * can't (the session runs here or in another Claude Code), the reason goes to the panel, which offers to stop
 * it or open a fork. `cwd` null: the home folder. `profileId` runs it with that Claude profile's login instead of
 * the session's or the folder's (signing a profile in).
 */
export async function openTerminal(client: EngineClient, owner: string, cwd: string | null, kind: TerminalKind, fork = false, profileId?: string): Promise<string | null> {
  const sessionId = ownerSession(owner);
  // Claude in the terminal starts work too: the focus limit's gate, as for a message (a fork is a new session).
  // Signing a profile in starts none.
  if (kind === 'claude' && !profileId && (await passFocusGate({ target: fork ? null : sessionId })) !== 'start') return null;
  const state = useTerminals.getState();
  state.setNotice(owner, null);
  state.togglePanel(owner, true);
  try {
    const info = await client.call('terminal.open', { sessionId, ...(cwd ? { cwd } : {}), kind, cols: 100, rows: 20, fork, ...(profileId ? { profileId } : {}) });
    useTerminals.getState().setActive(owner, info.id);
    return info.id;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const message = e instanceof Error ? e.message : String(e);
    const blocked = code === 'SESSION_RUNNING_HERE' || code === 'SESSION_BUSY_ELSEWHERE';
    useTerminals.getState().setNotice(owner, blocked ? { code, message } : { code: null, message: `Couldn't open the terminal: ${message}` });
    return null;
  }
}

/**
 * Another provider's session in its own CLI (`copilot --resume=…`), in the session's terminal panel, with its profile's
 * folder. The engine refuses while Seshboard runs it.
 */
export async function openInProviderCli(client: EngineClient, sessionId: string): Promise<void> {
  const info = await client.call('providers.openInCli', { sessionId });
  const state = useTerminals.getState();
  state.togglePanel(sessionId, true);
  state.setActive(sessionId, info.id);
}

/** The shell tab each session's code blocks run in, so runs share one tab instead of opening a new one every time. */
const runTabs = new Map<string, string>();

/**
 * Runs a command from the conversation (a code block's Run button) in the session's terminal: in the
 * shell tab earlier runs used while that shell is still open, or a new one. The tab is shown, with the
 * command typed and entered, so its output and any prompt it asks are right there.
 */
export async function runInTerminal(client: EngineClient, sessionId: string, cwd: string, command: string): Promise<void> {
  const state = useTerminals.getState();
  const reused = runTabs.get(sessionId);
  let id = reused && state.terminals.get(reused)?.exitCode === null ? reused : null;
  const fresh = !id;
  if (id) {
    state.setNotice(sessionId, null);
    state.togglePanel(sessionId, true);
    state.setActive(sessionId, id);
  } else {
    id = await openTerminal(client, sessionId, cwd, 'shell');
    if (!id) return;
    runTabs.set(sessionId, id);
  }
  // A new shell gets the command once it has started: typed while its config still loads (zsh plugins, prompt
  // themes), it shows up but can be thrown away before the prompt reads it.
  await client.call('terminal.write', { id, data: `${command}\r`, whenReady: fresh });
}

/**
 * Runs a code block's command and sends its output to Claude: in a tab of its own that ends with the command (so it is
 * clear where the output starts and stops, and what it exited with), shown in the panel. When it ends, the engine sends
 * the exit code and the end of the output to the session, held in Up next while Claude works.
 */
export async function runAndSendOutput(client: EngineClient, sessionId: string, cwd: string, command: string): Promise<void> {
  const state = useTerminals.getState();
  state.setNotice(sessionId, null);
  state.togglePanel(sessionId, true);
  try {
    const info = await client.call('terminal.run', { sessionId, cwd, command, sendOutput: true });
    useTerminals.getState().setActive(sessionId, info.id);
  } catch (e) {
    useTerminals.getState().setNotice(sessionId, { code: null, message: `Couldn't run the command: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/**
 * Resolves once the terminal has exited (or is gone), or after `timeoutMs`. Restart on a running action
 * stops it first, and the engine only restarts a terminal that has exited.
 */
export function waitForExit(id: string, timeoutMs: number): Promise<boolean> {
  const exited = () => {
    const t = useTerminals.getState().terminals.get(id);
    return !t || t.exitCode !== null;
  };
  if (exited()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = useTerminals.subscribe(() => {
      if (!exited()) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

/** Stop waits this long after ⌃C before it terminates, then kills (the engine's STOP_GRACE_MS, twice), plus a little. */
const STOP_TIMEOUT_MS = 7_000;

/** Terminals being restarted (stopped, then run again), so quick clicks on Restart send one restart. */
const restarting = new Set<string>();

/**
 * Runs a terminal's command again (an action's tab): a running one is stopped first, since the engine only restarts one
 * that has exited. A second call while the first is still going is ignored.
 */
export async function restartTerminal(client: EngineClient, terminal: TerminalInfo): Promise<void> {
  await runOnce(restarting, terminal.id, async () => {
    // The store's copy, not the one the click rendered: it may have exited, or started again, since.
    const current = useTerminals.getState().terminals.get(terminal.id) ?? terminal;
    if (current.exitCode === null) {
      await client.call('terminal.stop', { id: terminal.id });
      if (!(await waitForExit(terminal.id, STOP_TIMEOUT_MS))) throw new Error('it did not stop');
    }
    await client.call('terminal.restart', { id: terminal.id });
  });
}

/** How many sessions' open panels are remembered across launches. */
const REMEMBER_OPEN = 50;

/** Keeps the terminal list current and remembers which sessions had the panel open, its size and dock. */
export function useTerminalsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openFor = useTerminals((s) => s.openFor);
  const panelHeight = useTerminals((s) => s.panelHeight);
  const panelWidth = useTerminals((s) => s.panelWidth);
  const dock = useTerminals((s) => s.dock);

  useEffect(() => {
    if (!client) return;
    // A new client after one that had loaded means the engine restarted, and its terminals went with it. The first
    // list from the new one says which sessions lost theirs; their panels say so instead of just showing New terminal.
    const store = useTerminals.getState();
    let before: TerminalInfo[] | null = store.loaded ? [...store.terminals.values()] : null;
    const apply = (terminals: TerminalInfo[]) => {
      if (before) {
        for (const owner of panelsWithLostTerminals(before, terminals)) {
          useTerminals.getState().setNotice(owner, { code: ENGINE_RESTARTED, message: ENGINE_RESTARTED_MESSAGE });
        }
        before = null;
      }
      useTerminals.getState().setTerminals(terminals);
    };
    const off = client.on('terminals.changed', ({ terminals }) => apply(terminals));
    void client.call('terminal.list', {}).then(({ terminals }) => apply(terminals));
    void client.call('appState.get', { key: PANEL_KEY }).then(({ value }) => {
      const stored = value as { open?: unknown; height?: unknown; width?: unknown; dock?: unknown } | null;
      if (typeof stored?.height === 'number') useTerminals.getState().setPanelHeight(stored.height);
      if (typeof stored?.width === 'number') useTerminals.getState().setPanelWidth(stored.width);
      useTerminals.getState().setDock(parseDock(stored?.dock));
      // Before, `open` was one flag for every session; that one isn't carried over.
      if (Array.isArray(stored?.open)) useTerminals.getState().restoreOpen(stored.open.filter((id): id is string => typeof id === 'string'));
    });
    return off;
  }, [client]);

  // Saved by the main window only: a pop-out's smaller window would clamp the sizes it saves.
  useEffect(() => {
    if (!client || popoutSession) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: PANEL_KEY, value: { open: [...openFor].slice(-REMEMBER_OPEN), height: panelHeight, width: panelWidth, dock } }), 300);
    return () => clearTimeout(timer);
  }, [client, openFor, panelHeight, panelWidth, dock]);
}
