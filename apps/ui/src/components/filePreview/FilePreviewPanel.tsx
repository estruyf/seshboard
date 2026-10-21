import { Eye, Maximize2, X } from 'lucide-react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { tildify } from '../../lib/format.ts';
import { useFilePreview, type PreviewTarget } from '../../state/filePreviewStore.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';
import { useFilePreviewContent } from './useFilePreviewContent.tsx';

interface FilePreviewPanelProps {
  sessionId: string;
  target: PreviewTarget;
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the header's buttons. */
  tabs?: (actions: ReactNode) => ReactNode;
}

/**
 * A file preview on the right next to the conversation, a tab beside Changes, Ask, Agents and Commands: where a file link
 * in the session opens it, unless the reader detached the preview to a dialog (which the button here does).
 */
export function FilePreviewPanel({ sessionId, target, width, onWidth, tabs }: FilePreviewPanelProps) {
  const home = useHomeFolder();
  const { name, kind, switcher, tools, body } = useFilePreviewContent(target);
  const close = () => useFilePreview.getState().closePanel(sessionId);
  const detach = () => useFilePreview.getState().detach(sessionId);

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    close();
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };

  const actions = (
    <>
      <Button variant="quiet" size="sm" iconOnly icon={<Maximize2 size={13} aria-hidden />} aria-label="Open in a dialog" data-file-preview-detach="" onClick={detach} />
      <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close preview" data-file-preview-close="" onClick={close} />
    </>
  );
  const title = (
    <div className="grid min-w-0 flex-1">
      <h2 className="truncate text-ui font-semibold text-text">{name}</h2>
      <span className="truncate font-mono text-meta text-muted" data-tooltip={target.path}>
        {tildify(target.path, home)}
      </span>
    </div>
  );

  return (
    <aside
      aria-label={`Preview of ${name}`}
      tabIndex={-1}
      onKeyDown={onKey}
      className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col border-l border-border bg-bg outline-none"
      style={{ width }}
      data-file-preview=""
      data-file-preview-kind={kind}
      data-file-preview-place="panel"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Preview panel width"
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
        <>
          {tabs(actions)}
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">{title}</header>
        </>
      ) : (
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 pt-2.5 pb-2">
          <Eye size={16} aria-hidden className="mt-0.5 shrink-0 text-accent-ink" />
          {title}
          <div className="flex shrink-0 items-center">{actions}</div>
        </header>
      )}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" data-file-preview-toolbar="">
        {switcher}
        <div className="ml-auto flex items-center">{tools}</div>
      </div>
      {body}
    </aside>
  );
}
