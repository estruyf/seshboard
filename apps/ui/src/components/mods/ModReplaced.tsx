import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HookableComponent } from '@seshboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import { useMods, useSessionMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { modActionFailed, ModFrame } from './ModFrame.tsx';
import { CutNote, ModTree } from './ModTree.tsx';
import { drawnByLine, type Replaceable } from './modReplace.ts';
import { cutNote, isBlank, limitsFor, prepareTree } from './modTree.ts';
import { modShown } from './modVisibility.ts';
import { useCardColor, useCellMetrics, useModRender } from './useModRender.ts';

/**
 * A transcript item a mod replaces (`ToolUse`, `AssistantMessage`…): the mod's drawing in place, in a frame that says
 * "Drawn by agent-watch · replaces ToolUse", with the built-in component where the mod put its `engine` node. "Show
 * the built-in view" switches this one item back, for this session. Until the mod has drawn it, and whenever it
 * can't, the built-in view shows.
 */
const NONE: readonly HookableComponent[] = [];
/** How long a starting session holds back the built-in view of what its mods replaced last time. */
const HOLD_MS = 3_000;

/** What mods replaced last time in this session's profile, while its Claude Code is starting and hasn't said yet. */
export function useExpectedHooked(sessionId: string): readonly HookableComponent[] {
  const starting = useHosts((s) => s.hosts.get(sessionId)?.state === 'starting');
  const profileId = useHosts((s) => s.hosts.get(sessionId)?.profileId);
  const showMods = usePreferences((s) => s.prefs.showMods);
  const expected = useMods((s) => (profileId ? s.expected.get(profileId) : undefined)) ?? NONE;
  return starting && showMods ? expected : NONE;
}

export function ModReplaced({ sessionId, target, children }: { sessionId: string; target: Replaceable; children: ReactNode }) {
  const mods = useSessionMods(sessionId);
  const prefs = usePreferences((s) => s.prefs);
  const profileId = useHosts((s) => s.hosts.get(sessionId)?.profileId ?? null);
  const builtIn = useMods((s) => s.builtIn.get(sessionId)?.has(target.instanceId) ?? false);
  const enabled = prefs.showMods && mods.state.attached && mods.state.hooked.includes(target.component) && !builtIn;
  const { result, error, retry } = useModRender(sessionId, target.component, target.instanceId, target.props, enabled);
  const metrics = useCellMetrics();
  const background = useCardColor();
  const prepared = useMemo(() => (result ? prepareTree(result.tree, limitsFor('item')) : null), [result]);
  const drawnBy = result?.drawnBy ?? [];
  const visible = drawnBy.filter((plugin) => modShown(prefs, profileId, plugin));
  const label = drawnByLine(visible, target.component);
  useEffect(() => {
    for (const plugin of visible) useMods.getState().noteDraw(sessionId, plugin, `replaces ${target.component}`);
  }, [label, sessionId]);

  // Claude Code isn't ready, but a mod replaced this last time: hold the built-in view back a moment, so it doesn't
  // flash before the mod's drawing.
  const pending = !mods.state.attached && prefs.showMods && !builtIn;
  const [held, setHeld] = useState(pending);
  useEffect(() => {
    if (!pending) return setHeld(false);
    const timer = setTimeout(() => setHeld(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  if (!enabled) return held && pending ? <div className="min-h-6" aria-busy="true" data-mod-pending /> : <>{children}</>;
  const back = (
    <button
      type="button"
      onClick={() => useMods.getState().showBuiltIn(sessionId, target.instanceId)}
      className="rounded-sm text-meta font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
      data-mod-builtin
    >
      Show the built-in view
    </button>
  );
  if (error) {
    const owner = mods.state.plugins[0] ?? 'A mod';
    return (
      <ModFrame plugin={owner} title={drawnByLine([owner], target.component)} end={back} error={error} onRetry={retry} data-mod-replaced={target.component}>
        {children}
      </ModFrame>
    );
  }
  // Nothing drawn yet, Claude Code's own drawing (no mod named), every mod that drew it hidden, or only the built-in.
  if (!prepared || visible.length === 0 || isBlank(prepared.children)) return <>{children}</>;
  return (
    <ModFrame plugin={visible[0]!} title={label} end={back} data-mod-replaced={target.component}>
      <ModTree drawing={{ sessionId, component: target.component, instanceId: target.instanceId, metrics, background, engine: children, onError: (e) => modActionFailed(visible[0]!, e) }}>{prepared.children}</ModTree>
      {prepared.cut && <CutNote text={cutNote(prepared.cut, 'item', limitsFor('item'))} />}
    </ModFrame>
  );
}
