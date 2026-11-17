import { NotebookPen, X } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cleanNote, SESSION_NOTE_MAX } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { saveNote } from '../../state/sessionNotes.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';

interface NotePanelProps {
  sessionId: string;
  /** The note as saved, or null without one. */
  note: string | null;
  width: number;
  onWidth(width: number): void;
  onClose(): void;
}

/**
 * The session's note on the right next to the conversation (a tab beside Changes, Ask and Agents): the whole note,
 * which the sidebar row and the header cut short, in a field to change or clear it.
 */
export function NotePanel({ sessionId, note, width, onWidth, onClose }: NotePanelProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [value, setValue] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // A note saved elsewhere (N on the row, catch-up's Use as note) shows here too.
  useEffect(() => setValue(note ?? ''), [note]);
  const changed = cleanNote(value) !== note;

  const save = async (text: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveNote(client, sessionId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
      event.preventDefault();
      onClose();
    }
  };
  // The note is one line: Enter saves it, as in the note dialog.
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (changed) void save(value);
  };

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
    onWidth(next);
  };

  return (
    <aside aria-label="Note" tabIndex={-1} onKeyDown={onPanelKey} className="relative flex max-w-[min(85%,calc(100%-27.5rem))] min-w-0 shrink-0 flex-col bg-sidebar outline-none forced-colors:border-l" style={{ width }} data-note-panel>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Note panel width"
        aria-valuenow={width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
        data-tooltip="Drag (or use ← →) to resize"
      />
      <header className="flex shrink-0 items-start gap-2 px-3 pt-2.5 pb-2">
        <NotebookPen size={16} aria-hidden className="mt-0.5 shrink-0 text-accent-ink" />
        <div className="grid min-w-0 flex-1">
          <h2 className="truncate text-ui font-semibold text-text">Note</h2>
          <span className="text-meta text-muted">What's left in this session. It shows under its title in the sidebar.</span>
        </div>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close note" onClick={onClose} data-note-close />
      </header>
      <form
        className="flex min-h-0 flex-col gap-1.5 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) void save(value);
        }}
      >
        <label htmlFor={`${id}-note`} className="sr-only">
          Note
        </label>
        <textarea
          id={`${id}-note`}
          value={value}
          rows={4}
          maxLength={SESSION_NOTE_MAX}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onFieldKey}
          placeholder="push after review, waiting on Jan…"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full resize-none rounded-md border bg-bg px-2.5 py-1.5 text-body text-text outline-none select-text focus:border-accent-ink ${error ? 'border-error' : 'border-edge'}`}
          data-note-panel-input
        />
        <p className="text-meta text-muted">
          {value.length} / {SESSION_NOTE_MAX}
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-meta text-error">
            {`That didn't work: ${error}`}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          {note && (
            <Button size="sm" className="mr-auto" disabled={busy} onClick={() => void save(null)} data-note-panel-clear>
              Clear
            </Button>
          )}
          <Button type="submit" variant="primary" size="sm" kbd="↵" disabled={busy || !changed} aria-busy={busy || undefined} data-note-panel-save>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </aside>
  );
}
