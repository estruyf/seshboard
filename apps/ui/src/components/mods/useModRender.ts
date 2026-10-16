import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RpcError, type ModComponent, type ModRenderResult } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { instanceKey, useMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { DEFAULT_CELLS, type CellMetrics } from './modLayout.ts';

/** Why a drawing isn't there: Claude Code didn't answer in time, or the mod's drawing failed. */
export type ModRenderError = { kind: 'timeout' } | { kind: 'failed'; message: string };

interface Cached {
  version: number;
  props: string;
  result: ModRenderResult;
}

/** The last drawing per instance, so a remount (scrolling the transcript back) draws at once. */
const cache = new Map<string, Cached>();
const CACHE_MAX = 500;

function remember(key: string, value: Cached): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * Has the session's mods draw one component instance. It asks again only when an invalidate names this instance (or
 * all of them) or the props change; meanwhile it draws from the cache. Nothing is asked while the session isn't
 * attached (`enabled` false, Show mods off, or a Claude Code without mods).
 */
export function useModRender(sessionId: string, component: ModComponent, instanceId: string, props: Record<string, unknown>, enabled: boolean) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const key = `${sessionId}\0${instanceKey(component, instanceId)}`;
  const attached = useMods((s) => s.sessions.get(sessionId)?.state.attached ?? false);
  const version = useMods((s) => {
    const v = s.sessions.get(sessionId)?.versions;
    return v ? v.all * 1_000_000 + (v.instances.get(instanceKey(component, instanceId)) ?? 0) : 0;
  });
  const propsKey = useMemo(() => JSON.stringify(props), [props]);
  const [state, setState] = useState<{ key: string; result: ModRenderResult | null; error: ModRenderError | null }>(() => ({ key, result: cache.get(key)?.result ?? null, error: null }));
  const [attempt, setAttempt] = useState(0);
  // Try again asks once more even when the cache has this version.
  const answered = useRef(0);
  const active = enabled && attached && !!client;

  useEffect(() => {
    if (!active || !client) return;
    const hit = cache.get(key);
    if (hit && hit.version === version && hit.props === propsKey && attempt === answered.current) {
      setState({ key, result: hit.result, error: null });
      return;
    }
    let live = true;
    client
      .call('mods.render', { sessionId, component, instanceId, props: JSON.parse(propsKey) as Record<string, unknown> })
      .then((result) => {
        answered.current = attempt;
        remember(key, { version, props: propsKey, result });
        if (live) setState({ key, result, error: null });
      })
      .catch((error: unknown) => {
        if (!live) return;
        // Turned off meanwhile: nothing to say.
        if (error instanceof RpcError && (error.code === 'MODS_OFF' || error.code === 'NOT_RUNNING')) return setState({ key, result: null, error: null });
        const kind = error instanceof RpcError && error.code === 'MOD_TIMEOUT' ? 'timeout' : 'failed';
        setState((s) => ({ key, result: s.key === key ? s.result : null, error: kind === 'timeout' ? { kind } : { kind, message: error instanceof Error ? error.message : String(error) } }));
      });
    return () => {
      live = false;
    };
  }, [active, client, key, version, propsKey, attempt, sessionId, component, instanceId]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state.key === key ? state : { result: cache.get(key)?.result ?? null, error: null };
  return { result: active ? current.result : null, error: active ? current.error : null, retry };
}

/** Drops cached drawings of a session (it stopped, or Show mods went off). */
export function forgetModRenders(sessionId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${sessionId}\0`)) cache.delete(key);
}

let measured: CellMetrics | null = null;

/** One cell of the mono font at the size Code uses (`text-ui`), measured once in this window. */
export function useCellMetrics(): CellMetrics {
  const [metrics, setMetrics] = useState<CellMetrics>(measured ?? DEFAULT_CELLS);
  useEffect(() => {
    if (measured) return;
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(100);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:var(--font-mono);font-size:12px;line-height:1.5';
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    if (rect.width > 0) {
      measured = { ch: rect.width / 100, lh: rect.height };
      setMetrics(measured);
    }
  }, []);
  return metrics;
}

/** The colour of the frame's surface (`card`) in the theme that is on, for lifting hex colours. */
export function useCardColor(): string {
  const theme = usePreferences((s) => `${s.prefs.themeId}:${s.prefs.colorScheme}`);
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  // Read after the theme's style has been applied (the next frame), so a switch is picked up.
  const [color, setColor] = useState(readCard);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setColor(readCard()));
    return () => cancelAnimationFrame(frame);
  }, [theme, dark]);
  return color;
}

const readCard = () => getComputedStyle(document.documentElement).getPropertyValue('--sb-card').trim() || '#1b1f2a';
