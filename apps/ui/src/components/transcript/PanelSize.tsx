import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { useRightPanel } from '../../state/rightPanelStore.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';

type PanelSizing = 'side' | 'half' | 'full';

/** Side or Half for every panel on the right, Full for this one. */
function choosePanelSize(value: PanelSizing, onChange: (full: boolean) => void): void {
  if (value !== 'full') useRightPanel.getState().setSizing(value);
  onChange(value === 'full');
}

const SIZE_LABEL: Record<PanelSizing, string> = { side: 'Side', half: 'Half', full: 'Full' };

/**
 * The panel's sizes: beside the conversation at the width you dragged (Side), sharing the session area 50/50 (Half,
 * for every panel on the right, `useRightPanel().sizing`), or the whole session area (Full, this panel). The same in
 * every panel's header: three segments, or one button that names the size and opens the three when the header (a
 * `@container/toolbar`) is narrow. `room` is how much the header needs for the segments: under 420px (`sm`), or
 * under 560px (`lg`) for a header with more in it (Changes, the terminal's tabs).
 */
export function PanelSize({ full, onChange, room = 'sm' }: { full: boolean; onChange(full: boolean): void; room?: 'sm' | 'lg' }) {
  const sizing = useRightPanel((s) => s.sizing);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const value: PanelSizing = full ? 'full' : sizing;
  const pick = (next: PanelSizing) => choosePanelSize(next, onChange);
  return (
    <>
      <span className={room === 'lg' ? 'contents @max-[560px]/toolbar:hidden' : 'contents @max-[420px]/toolbar:hidden'}>
        <SegmentedControl
          mode="radio"
          size="sm"
          label="Panel size"
          value={value}
          onChange={pick}
          segments={(['side', 'half', 'full'] as const).map((size) => ({ value: size, label: SIZE_LABEL[size], data: { 'data-web-preview-size': size, 'data-panel-size': size } }))}
          className="ml-1"
        />
      </span>
      <span className={room === 'lg' ? 'hidden @max-[560px]/toolbar:contents' : 'hidden @max-[420px]/toolbar:contents'}>
        <Button
          variant="quiet"
          size="sm"
          aria-label={`Panel size: ${SIZE_LABEL[value]}`}
          data-tooltip="Panel size"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu(menu ? null : { x: rect.right - 140, y: rect.bottom + 4 });
          }}
          className="ml-0.5 shrink-0"
          data-web-preview-size-menu={value}
          data-panel-size-menu={value}
        >
          {SIZE_LABEL[value]}
          <ChevronDown size={11} aria-hidden />
        </Button>
      </span>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Panel size"
          entries={(['side', 'half', 'full'] as const).map((size) => ({ label: SIZE_LABEL[size], checked: value === size, onSelect: () => pick(size), data: { 'data-web-preview-size': size, 'data-panel-size': size } }))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** ‹ Conversation, on the left of the toolbar in Full. */
export function BackToConversation({ onClick }: { onClick(): void }) {
  return (
    <Button variant="quiet" size="sm" icon={<ChevronLeft size={13} aria-hidden />} onClick={onClick} className="mr-1" data-web-preview-conversation="" data-panel-conversation="">
      Conversation
    </Button>
  );
}

/**
 * The left edge of a panel on the right: drag it, or press ← → on it, to resize. Either one makes the panels Side again
 * at that width (`useRightPanel().setWidth`). Sits inside the panel's `relative` aside.
 */
export function PanelResizeEdge({ width, onWidth, label }: { width: number; onWidth(width: number): void; label: string }) {
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    // From the width on screen: the stored one can be wider than the session area lets the panel be.
    const startWidth = Math.min(width, event.currentTarget.parentElement?.getBoundingClientRect().width ?? width);
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
    event.stopPropagation();
    onWidth(next);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={ASK_MIN_WIDTH}
      aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={resizeByKey}
      className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
      data-tooltip="Drag (or use ← →) to resize"
      data-panel-resize=""
    />
  );
}

/** A panel on the right: its own width beside the conversation, or the whole session area at Full. */
export const sidePanelClass = (full: boolean): string =>
  full ? 'relative flex min-w-0 flex-1 flex-col bg-sidebar outline-none' : 'relative flex max-w-[min(85%,calc(100%-27.5rem))] min-w-0 shrink-0 flex-col bg-sidebar outline-none forced-colors:border-l';
