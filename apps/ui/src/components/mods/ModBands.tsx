import { useEffect, useMemo, useRef, useState } from 'react';
import { ABOVE_PROMPT_INSTANCE } from '@switchboard/protocol/client';
import { useMods, useSessionMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { modActionFailed, ModFrame } from './ModFrame.tsx';
import { CutNote, ModTree } from './ModTree.tsx';
import { BAND_MAX_PX } from './modStack.ts';
import { cutNote, limitsFor, prepareTree, splitParts, type ModPart } from './modTree.ts';
import { shownMods } from './modVisibility.ts';
import { useCardColor, useCellMetrics, useModRender } from './useModRender.ts';
import { useModSite } from './useModSite.ts';
import type { CellMetrics } from './modLayout.ts';

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
    const observer = new ResizeObserver(() => setColumns(Math.max(20, Math.floor((el.clientWidth - 24) / metrics.ch))));
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
  const owner = result?.drawnBy[0] ?? mods.state.plugins[0] ?? 'mod';
  const parts = useMemo(() => (prepared && result ? shownMods(prefs, profileId, splitParts(prepared.children, owner, result.drawnBy)) : []), [prepared, result, owner, prefs, profileId]);

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
      <div ref={scroller} className="overflow-y-auto px-3 py-2" style={{ maxHeight: BAND_MAX_PX - 24 }} data-mod-band-body>
        <ModTree drawing={{ sessionId, component: 'AbovePrompt', instanceId: ABOVE_PROMPT_INSTANCE, metrics, background, onError: (error) => modActionFailed(part.plugin, error) }}>{part.children}</ModTree>
        {note && <CutNote text={note} />}
      </div>
    </ModFrame>
  );
}
