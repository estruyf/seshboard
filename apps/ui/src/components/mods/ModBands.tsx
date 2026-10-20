import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ABOVE_PROMPT_INSTANCE } from '@switchboard/protocol/client';
import { useMods, useSessionMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { modActionFailed, ModFrame } from './ModFrame.tsx';
import { CutNote, ModTree } from './ModTree.tsx';
import { BAND_MAX_PX } from './modStack.ts';
import { cutNote, limitsFor, prepareTree, splitParts, type ModPart } from './modTree.ts';
import { modShown } from './modVisibility.ts';
import { useCardColor, useCellMetrics, useModRender } from './useModRender.ts';
import { useModSite } from './useModSite.ts';
import type { CellMetrics } from './modLayout.ts';

/** The owner of a band no mod is named for. */
const UNNAMED = 'mod';

/** The frame's header and body padding, which the 160px include. */
const FRAME_CHROME_PX = 24 + 16;

/**
 * The mods' bands above the message box (`AbovePrompt`), each in its own frame with its name, in plugin order. They
 * sit under Switchboard's own permission cards and above Up next (see `promptStack`). A band is at most 160px tall
 * and scrolls inside.
 */
export function ModBands({ sessionId, profileId, working }: { sessionId: string; profileId: string | null; working: boolean }) {
  const prefs = usePreferences((s) => s.prefs);
  const mods = useSessionMods(sessionId);
  const metrics = useCellMetrics();
  const background = useCardColor();
  const wrap = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(80);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setColumns(Math.max(20, Math.floor((el.clientWidth - 20) / metrics.ch))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [metrics.ch]);
  const maxRows = Math.max(1, Math.floor((BAND_MAX_PX - FRAME_CHROME_PX) / metrics.lh));
  const props = useMemo(
    () => ({ hasSurvey: false, isWorking: working, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} }),
    [working, maxRows, columns],
  );
  const enabled = prefs.showMods && mods.state.attached;
  const { result, error, retry } = useModRender(sessionId, 'AbovePrompt', ABOVE_PROMPT_INSTANCE, props, enabled);
  const prepared = useMemo(() => (result ? prepareTree(result.tree, limitsFor('band')) : null), [result]);
  // Called on every render (hooks keep their order), but it only lists the mods when Claude Code names no owner.
  const drawnBy = result?.drawnBy ?? [];
  const profileMods = useProfileMods(profileId, drawnBy.length === 0);
  const owner = drawnBy[0] ?? (profileMods?.length === 1 ? profileMods[0]!.name : null) ?? UNNAMED;
  // A drawing no mod is named for can't be split per mod, so no one switch can hide just its share: it shows only while
  // every mod of the profile is on (and not before the list is in, so a mod that is off doesn't flash).
  const allOn = profileMods !== null && profileMods.every((m) => modShown(prefs, m.profileId, m.name));
  const parts = useMemo(() => {
    if (!prepared || !result) return [];
    const split = splitParts(prepared.children, owner, result.drawnBy);
    return split.filter((part) => (part.plugin === UNNAMED ? prefs.showMods && allOn : modShown(prefs, profileId, part.plugin)));
  }, [prepared, result, owner, prefs, profileId, allOn]);

  const drawn = parts.map((p) => p.plugin).join('\n');
  useEffect(() => {
    for (const plugin of drawn ? drawn.split('\n') : []) useMods.getState().noteDraw(sessionId, plugin, 'band');
  }, [drawn, sessionId]);

  if (!enabled) return <div ref={wrap} hidden />;
  // A band that didn't answer says so in its frame; nothing hooked on the band, nothing to say.
  const failed = error && (result?.hooked ?? mods.state.plugins.length > 0);
  return (
    <div ref={wrap} className="grid gap-2 empty:hidden" data-mod-bands>
      {failed ? (
        <ModFrame plugin={owner} end="band" error={error} onRetry={retry} data-mod-band={owner} />
      ) : (
        parts.map((part, i) => (
          <ModBand
            key={part.plugin}
            part={part}
            sessionId={sessionId}
            metrics={metrics}
            background={background}
            note={i === parts.length - 1 && prepared?.cut ? cutNote(prepared.cut, 'band', limitsFor('band')) : null}
          />
        ))
      )}
    </div>
  );
}

function ModBand({ part, sessionId, metrics, background, note }: { part: ModPart; sessionId: string; metrics: CellMetrics; background: string; note: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  useModSite(sessionId, 'AbovePrompt', ABOVE_PROMPT_INSTANCE, scroller, metrics, true);
  return (
    <ModFrame plugin={part.plugin} end="band" bodyClassName="p-0" data-mod-band={part.plugin}>
      <div ref={scroller} className="overflow-y-auto px-2.5 py-2" style={{ maxHeight: BAND_MAX_PX - 24 }} data-mod-band-body>
        <ModTree drawing={{ sessionId, component: 'AbovePrompt', instanceId: ABOVE_PROMPT_INSTANCE, metrics, background, onError: (error) => modActionFailed(part.plugin, error) }}>{part.children}</ModTree>
        {note && <CutNote text={note} />}
      </div>
    </ModFrame>
  );
}

/** The profile's mods (null until they are in), for a band Claude Code names no owner for. `needed`: list them only then. */
function useProfileMods(profileId: string | null, needed: boolean): ModInfo[] | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [mods, setMods] = useState<ModInfo[] | null>(null);
  useEffect(() => {
    if (!client || !needed) return;
    void client.call('mods.list', {}).then(({ mods }) => setMods(mods), () => setMods([]));
  }, [client, needed]);
  return useMemo(() => mods?.filter((m) => !profileId || m.profileId === profileId) ?? null, [mods, profileId]);
}
