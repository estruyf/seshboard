import { useEffect, useRef, type RefObject } from 'react';
import type { ModSite } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import type { CellMetrics } from './modLayout.ts';

/** The rows a scroll position is, in the mono font's line height. */
export function scrollRows(el: { scrollTop: number; clientHeight: number; scrollHeight: number }, lh: number) {
  const row = Math.max(1, lh);
  return { offset: Math.max(0, Math.round(el.scrollTop / row)), bodyRows: Math.max(0, Math.floor(el.clientHeight / row)), contentRows: Math.max(0, Math.ceil(el.scrollHeight / row)) };
}

/**
 * A band or a pane: its scrolling and keyboard focus go to the mod (`ui_scroll`, `ui_focus`), and the mod's own
 * scrolls and focus moves (pushed by Claude Code) land here.
 */
export function useModSite(sessionId: string, component: ModSite, instanceId: string, ref: RefObject<HTMLElement | null>, metrics: CellMetrics, enabled: boolean): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const last = useRef(0);
  const lh = metrics.lh;

  useEffect(() => {
    const el = ref.current;
    if (!client || !el || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A scroll the mod asked for is not sent back.
    let placing = false;
    const onScroll = () => {
      if (placing) {
        placing = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rows = scrollRows(el, lh);
        const by = rows.offset - last.current;
        if (by === 0) return;
        last.current = rows.offset;
        void client.call('mods.scroll', { sessionId, component, instanceId, ...rows, by }).catch(() => {});
      }, 100);
    };
    const held = (isHeld: boolean) => void client.call('mods.focus', { sessionId, component, instanceId, isHeld }).catch(() => {});
    const onFocusIn = (event: FocusEvent) => {
      if (!el.contains(event.relatedTarget as Node | null)) held(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!el.contains(event.relatedTarget as Node | null)) held(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    const offs = [
      client.on('mods.scroll', (event) => {
        if (event.sessionId !== sessionId || event.component !== component || event.instanceId !== instanceId) return;
        placing = true;
        el.scrollTop = event.followEnd ? el.scrollHeight : event.offset * lh;
        last.current = scrollRows(el, lh).offset;
      }),
      client.on('mods.focus', (event) => {
        if (event.sessionId !== sessionId || event.component !== component || event.instanceId !== instanceId) return;
        const key = CSS.escape(event.key);
        el.querySelector<HTMLElement>(`[data-mod-button="${key}"], [data-mod-input="${key}"], [data-mod-select="${key}"]`)?.focus();
      }),
    ];
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      offs.forEach((off) => off());
    };
  }, [client, enabled, sessionId, component, instanceId, ref, lh]);
}
