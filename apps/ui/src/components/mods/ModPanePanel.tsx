import { Puzzle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { ModPane } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { holdModToasts } from '../../state/useModsSync.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';
import { modActionFailed, ModError } from './ModFrame.tsx';
import { CutNote, ModTree } from './ModTree.tsx';
import { cutNote, limitsFor, prepareTree } from './modTree.ts';
import { useCardColor, useCellMetrics, useModRender } from './useModRender.ts';
import { useModSite } from './useModSite.ts';

interface ModPanePanelProps {
  sessionId: string;
  pane: ModPane;
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the title, with the panel's buttons on its right. */
  tabs?: (actions: ReactNode) => ReactNode;
  /** You closed it (its close button, or Esc when the mod allows it). */
  onClose(): void;
  /** Bumped when Claude Code asks for this pane to take the keyboard. */
  focusNonce: number;
}

/**
 * A mod's pane in the right panel, next to Changes and Ask: a line under the tabs says which mod draws it. Esc closes
 * it when the mod allows that (`close_on_escape`), and the keyboard goes back to the message box; toasts wait while it
 * has the keyboard when the mod asks (`hold_toasts`).
 */
export function ModPanePanel({ sessionId, pane, width, onWidth, tabs, onClose, focusNonce }: ModPanePanelProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const asideRef = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const metrics = useCellMetrics();
  const background = useCardColor();
  const [focused, setFocused] = useState(false);
  const [size, setSize] = useState({ columns: 40, rows: 30 });
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ columns: Math.max(10, Math.floor((el.clientWidth - 24) / metrics.ch)), rows: Math.max(4, Math.floor((el.clientHeight - 16) / metrics.lh)) }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [metrics.ch, metrics.lh]);
  const props = useMemo(
    () => ({ title: pane.title, isFocused: focused, bodyColumns: size.columns, placement: 'dock', scroll: { offset: 0, bodyRows: size.rows }, view: {} }),
    [pane.title, focused, size.columns, size.rows],
  );
  const { result, error, retry } = useModRender(sessionId, 'Pane', pane.id, props, true);
  const prepared = useMemo(() => (result ? prepareTree(result.tree, limitsFor('pane')) : null), [result]);
  useModSite(sessionId, 'Pane', pane.id, body, metrics, true);

  // Claude Code asked for the pane to take the keyboard.
  useEffect(() => {
    if (focusNonce > 0) requestAnimationFrame(() => asideRef.current?.focus());
  }, [focusNonce]);
  // The keyboard leaving lets held toasts show.
  useEffect(() => () => holdModToasts(sessionId, false), [sessionId]);

  const tellFocus = (id: string | null) => void client?.call('mods.pane', { sessionId, action: 'focus', id }).catch(() => {});
  const onFocus = (event: React.FocusEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocused(true);
    tellFocus(pane.id);
    if (pane.holdToasts) holdModToasts(sessionId, true);
  };
  const onBlur = (event: React.FocusEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocused(false);
    tellFocus(null);
    if (pane.holdToasts) holdModToasts(sessionId, false);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !pane.closeOnEscape) return;
    if (event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog], [role=listbox]')) return;
    event.preventDefault();
    onClose();
    useDrafts.getState().requestFocus(sessionId);
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };

  const actions = <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label={`Close ${pane.title}`} onClick={onClose} data-mod-pane-close />;
  const source = (
    <p className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1 text-meta text-muted" data-mod-pane-source>
      <Puzzle size={11} className="shrink-0" aria-hidden />
      <span className="truncate">From {pane.plugin} · pane</span>
    </p>
  );

  return (
    <aside
      ref={asideRef}
      aria-label={pane.title}
      tabIndex={-1}
      onKeyDown={onKey}
      onFocus={onFocus}
      onBlur={onBlur}
      className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none"
      style={{ width }}
      data-mod-pane={pane.id}
      data-mod-frame={pane.plugin}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`${pane.title} panel width`}
        aria-valuenow={width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
        data-tooltip="Drag (or use ← →) to resize"
      />
      {tabs ? (
        tabs(actions)
      ) : (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Puzzle size={14} aria-hidden className="shrink-0 text-muted" />
          <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-text">{pane.title}</h2>
          {actions}
        </header>
      )}
      {source}
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-body" data-mod-pane-body>
        {error ? (
          <ModError plugin={pane.plugin} error={error} onRetry={retry} />
        ) : prepared ? (
          <>
            <ModTree drawing={{ sessionId, component: 'Pane', instanceId: pane.id, metrics, background, onError: (e) => modActionFailed(pane.plugin, e) }}>{prepared.children}</ModTree>
            {prepared.cut && <CutNote text={cutNote(prepared.cut, 'pane', limitsFor('pane'))} />}
          </>
        ) : null}
      </div>
    </aside>
  );
}
