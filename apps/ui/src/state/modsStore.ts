import { create } from 'zustand';
import type { HookableComponent, ModInstance, ModPaneRoster, ModsSnapshot, ModsSurfaceState, ModStatus } from '@switchboard/protocol/client';

/**
 * What every running session's Claude Code mods show (`mods.*` events): whether they are attached, their statuses and
 * panes, and a version per drawn instance that `ui_invalidate` bumps, so only the instances it lists draw again.
 */
export interface SessionMods {
  state: ModsSurfaceState;
  statuses: ModStatus[];
  panes: ModPaneRoster;
  /** Bumped for every instance (an invalidate without a list) and per `component:instanceId`. */
  versions: { all: number; instances: ReadonlyMap<string, number> };
  /** What each mod was seen drawing here besides its panes and status: `band`, `toasts`, `replaces ToolUse`. */
  draws: ReadonlyMap<string, ReadonlySet<string>>;
}

/** What a mod draws in a session, as the mods popover lists it: band, pane, status, toasts, replaces …. */
export function drawsOf(mods: SessionMods, plugin: string): string[] {
  const seen = mods.draws.get(plugin) ?? new Set<string>();
  const kinds = [
    seen.has('band') && 'band',
    mods.panes.panes.some((p) => p.plugin === plugin) && 'pane',
    mods.statuses.some((s) => s.plugin === plugin) && 'status',
    seen.has('toasts') && 'toasts',
  ].filter((k): k is string => typeof k === 'string');
  return [...kinds, ...[...seen].filter((k) => k.startsWith('replaces ')).sort()];
}

export const EMPTY_ROSTER: ModPaneRoster = { panes: [], shownId: null, focusedId: null, focusRequestedId: null };
const NO_VERSIONS: SessionMods['versions'] = { all: 0, instances: new Map() };

/** The key of a drawn instance in `versions`. */
export const instanceKey = (component: string, instanceId: string) => `${component}:${instanceId}`;

/** The versions after an invalidate: the listed instances, or all of them (null). */
export function bumpVersions(versions: SessionMods['versions'], instances: readonly ModInstance[] | null): SessionMods['versions'] {
  if (instances === null) return { all: versions.all + 1, instances: versions.instances };
  const next = new Map(versions.instances);
  for (const { component, instanceId } of instances) {
    const key = instanceKey(component, instanceId);
    next.set(key, (next.get(key) ?? 0) + 1);
  }
  return { all: versions.all, instances: next };
}

const blank = (sessionId: string): SessionMods => ({
  state: { sessionId, supported: false, attached: false, hooked: [], promptsScreened: false, plugins: [] },
  statuses: [],
  panes: EMPTY_ROSTER,
  versions: NO_VERSIONS,
  draws: new Map(),
});

interface ModsState {
  sessions: ReadonlyMap<string, SessionMods>;
  /** Items you switched back to the built-in view ("Show the built-in view"), per session. */
  builtIn: ReadonlyMap<string, ReadonlySet<string>>;
  /** What mods replaced last time per profile (`mods.hooked`), for a session whose Claude Code isn't ready yet. */
  expected: ReadonlyMap<string, readonly HookableComponent[]>;
  setExpected(profileId: string, hooked: readonly HookableComponent[]): void;
  replace(snapshots: readonly ModsSnapshot[]): void;
  setState(state: ModsSurfaceState): void;
  setStatuses(sessionId: string, statuses: ModStatus[]): void;
  setPanes(sessionId: string, roster: ModPaneRoster): void;
  invalidate(sessionId: string, instances: ModInstance[] | null): void;
  showBuiltIn(sessionId: string, instanceId: string): void;
  /** A mod drew a band, sent a toast or replaced a component in this session. */
  noteDraw(sessionId: string, plugin: string, kind: string): void;
}

export const useMods = create<ModsState>()((set) => {
  const patch = (sessionId: string, change: (current: SessionMods) => Partial<SessionMods>) =>
    set((s) => {
      const current = s.sessions.get(sessionId) ?? blank(sessionId);
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...current, ...change(current) });
      return { sessions };
    });
  return {
    sessions: new Map(),
    builtIn: new Map(),
    expected: new Map(),
    setExpected: (profileId, hooked) => set((s) => ({ expected: new Map(s.expected).set(profileId, hooked) })),
    replace: (snapshots) =>
      set((s) => ({
        sessions: new Map(
          snapshots.map((snap) => [
            snap.state.sessionId,
            {
              state: snap.state,
              statuses: snap.statuses,
              panes: snap.panes,
              versions: bumpVersions(s.sessions.get(snap.state.sessionId)?.versions ?? NO_VERSIONS, null),
              draws: new Map([...(s.sessions.get(snap.state.sessionId)?.draws ?? []), ...snap.toasts.map((t) => [t.plugin, new Set(['toasts'])] as const)]),
            },
          ]),
        ),
      })),
    setState: (state) =>
      // Attaching again draws everything again.
      patch(state.sessionId, (current) => ({ state, versions: state.attached && !current.state.attached ? bumpVersions(current.versions, null) : current.versions })),
    setStatuses: (sessionId, statuses) => patch(sessionId, () => ({ statuses })),
    setPanes: (sessionId, panes) => patch(sessionId, () => ({ panes })),
    invalidate: (sessionId, instances) => patch(sessionId, (current) => ({ versions: bumpVersions(current.versions, instances) })),
    noteDraw: (sessionId, plugin, kind) => {
      if (useMods.getState().sessions.get(sessionId)?.draws.get(plugin)?.has(kind)) return;
      patch(sessionId, (current) => {
        const draws = new Map(current.draws);
        draws.set(plugin, new Set([...(draws.get(plugin) ?? []), kind]));
        return { draws };
      });
    },
    showBuiltIn: (sessionId, instanceId) =>
      set((s) => {
        const builtIn = new Map(s.builtIn);
        builtIn.set(sessionId, new Set([...(s.builtIn.get(sessionId) ?? []), instanceId]));
        return { builtIn };
      }),
  };
});

const NONE = blank('');

/** A session's mods (an empty, unattached surface when it has none). */
export function useSessionMods(sessionId: string | null | undefined): SessionMods {
  return useMods((s) => (sessionId ? s.sessions.get(sessionId) : undefined)) ?? NONE;
}
