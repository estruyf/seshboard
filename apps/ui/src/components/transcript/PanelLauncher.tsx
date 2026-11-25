import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { launcherKey } from './panelLauncher.ts';
import type { RailToolId } from './toolRail.ts';
import { PanelResizeEdge, PanelSize, sidePanelClass } from './PanelSize.tsx';

/** A row of the empty side panel's list, as the session view resolves it from the rail's own item for the tool. */
export interface LauncherRow {
  id: RailToolId;
  icon: ReactNode;
  name: string;
  /** The shortcut, as `formatKeys` writes it. */
  kbd?: string;
}

/**
 * The side panel with nothing in it (the rail's Show panel): a list of the tools that can open here, each with its icon,
 * name and shortcut. No header, only the panel's size (Side, Half, Full) at the top right: the rail's panel button and
 * Esc close it. Its left edge resizes it, as every panel's does. The list is one block at a menu's width,
 * in the middle of the panel both ways, so each shortcut sits next to its name; taller than the panel, it starts at the
 * top and scrolls (auto margins in a flex box give way). A pick opens the tool in its place. ↑ ↓ Home End move through
 * the list, Enter opens, Esc closes the panel. The first row takes the focus when it opens, unless `quiet` (a new
 * session opens it beside the message box, which keeps the focus).
 */
export function PanelLauncher({ rows, width, onWidth, full, onFull, quiet = false, onPick, onClose }: {
  rows: readonly (LauncherRow | 'divider')[];
  width: number;
  onWidth(width: number): void;
  /** It takes the whole session area. */
  full: boolean;
  onFull(full: boolean): void;
  quiet?: boolean;
  onPick(id: RailToolId): void;
  onClose(): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // After whatever opened it (a palette that hands the focus back as it closes) is done with the focus.
  useEffect(() => {
    if (quiet) return;
    const frame = requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[data-panel-launcher-item]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-panel-launcher-item]') ?? [])];
    const next = launcherKey(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <aside
      aria-label="Side panel"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={sidePanelClass(full)}
      style={full ? undefined : { width }}
      data-panel-launcher-panel
      data-panel-full={full || undefined}
    >
      {!full && <PanelResizeEdge width={width} onWidth={onWidth} label="Side panel width" />}
      {/* Over the list's padding, the same at the bottom, so the list stays in the middle of the panel. */}
      <div className="@container/toolbar pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-end *:pointer-events-auto" data-panel-launcher-size>
        <PanelSize full={full} onChange={onFull} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto px-3 py-11">
        <ul ref={list} aria-label="Open in the side panel" className="m-auto flex w-full max-w-70 flex-col gap-px" data-panel-launcher>
          {rows.map((row, i) =>
            row === 'divider' ? (
              <li key={`divider-${i}`} aria-hidden className="mx-2.5 my-1 h-px shrink-0 bg-border" />
            ) : (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onPick(row.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui text-text outline-none hover:bg-border/45 focus-visible:bg-selected"
                  data-panel-launcher-item={row.id}
                >
                  <span aria-hidden className="flex w-4 shrink-0 justify-center text-muted [&>*]:size-4">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.kbd && <span className="shrink-0 text-meta text-faint">{row.kbd}</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    </aside>
  );
}
