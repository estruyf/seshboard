import type { SessionView } from '@seshboard/protocol/bridge';
import { useAgentsPanel } from './agentsPanelStore.ts';
import { useAsk } from './askStore.ts';
import { useChangesPanel } from './changesPanelStore.ts';
import { useCommandsPanel } from './commandsPanelStore.ts';
import { useRightPanel } from './rightPanelStore.ts';
import { applyView, collectView, parseView, type SessionViewState, type ViewSlices } from './sessionViewState.ts';
import { useTerminals } from './terminalsStore.ts';

/** The stores' state a session's view is made of (`sessionViewState.ts` does the work on it). */
function slices(): ViewSlices {
  const right = useRightPanel.getState();
  const terminals = useTerminals.getState();
  return {
    changes: useChangesPanel.getState().open,
    ask: useAsk.getState().sessions,
    agents: useAgentsPanel.getState().sessions,
    commands: useCommandsPanel.getState().sessions,
    tabs: right.tabs,
    tab: right.tab,
    terminalOpen: terminals.openFor,
    terminalMaximized: terminals.maximizedFor,
    terminalTab: terminals.active,
  };
}

/** How this window has a session's panels now. */
export function readSessionView(sessionId: string): SessionViewState {
  return collectView(sessionId, slices());
}

/** Puts a session's panels as another window had them. Only the stores whose part changes are touched. */
export function writeSessionView(sessionId: string, view: SessionViewState): void {
  const before = slices();
  const after = applyView(sessionId, view, before);
  if (after.changes !== before.changes) useChangesPanel.setState({ open: after.changes as Set<string> });
  if (after.ask !== before.ask) useAsk.setState({ sessions: after.ask });
  if (after.agents !== before.agents) useAgentsPanel.setState({ sessions: after.agents });
  if (after.commands !== before.commands) useCommandsPanel.setState({ sessions: after.commands });
  // Only the session's own pick: the window's default tab (for sessions that picked none) stays.
  if (after.tabs !== before.tabs) useRightPanel.setState({ tabs: after.tabs });
  if (after.terminalOpen !== before.terminalOpen || after.terminalMaximized !== before.terminalMaximized || after.terminalTab !== before.terminalTab) {
    useTerminals.setState({ openFor: after.terminalOpen as Set<string>, maximizedFor: after.terminalMaximized as Set<string>, active: after.terminalTab as Map<string, string> });
  }
}

/** A view from another window (checked first): puts it on the session. A view that isn't one changes nothing. */
export function receiveSessionView(sessionId: string, view: SessionView | null | undefined): void {
  const parsed = parseView(view);
  if (parsed) writeSessionView(sessionId, parsed);
}

/** The panels' stores each keep their state in a map or set; a change to any of them is a change to a view. */
export function subscribeSessionViews(listener: () => void): () => void {
  const offs = [
    useChangesPanel.subscribe(listener),
    useAsk.subscribe((state, previous) => state.sessions !== previous.sessions && listener()),
    useAgentsPanel.subscribe((state, previous) => state.sessions !== previous.sessions && listener()),
    useCommandsPanel.subscribe((state, previous) => state.sessions !== previous.sessions && listener()),
    useRightPanel.subscribe((state, previous) => (state.tabs !== previous.tabs || state.tab !== previous.tab) && listener()),
    useTerminals.subscribe((state, previous) => (state.openFor !== previous.openFor || state.maximizedFor !== previous.maximizedFor || state.active !== previous.active) && listener()),
  ];
  return () => offs.forEach((off) => off());
}
