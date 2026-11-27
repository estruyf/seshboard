import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { usePreferences } from '../../../state/preferencesStore.ts';
import { useThemes } from '../../../state/themeStore.ts';
import { useDark } from '../../transcript/VisualBlock.tsx';
import type { FileEditorHandle } from './monacoEditor.ts';

interface FileEditorProps {
  path: string;
  /** The file in edit mode (`editKey`): the model kept for it is used again. */
  editKey: string;
  /** Goes up when the editor starts again from `value` (a new text from disk). */
  seq: number;
  /** The text on disk, for a new model. */
  value: string;
  extension: string | undefined;
  wrap: boolean;
  /** Takes the focus once it is ready (the editor in front). */
  autoFocus?: boolean;
  onDirty(dirty: boolean): void;
  onSave(): void;
  /** Whether the file is still in edit mode when the editor goes away: its model is then kept for the next one. */
  keep(): boolean;
  /** Lines Claude changed in this file (from Changes), with what they were: a bar in the gutter, the old text on hover. */
  marks?: ReadonlyMap<number, string | null>;
  /** Search in files' matches in this file, and the one picked. */
  search?: { matches: ReadonlyArray<{ line: number; column: number; length: number }>; current: number };
  /** The lines picked changed (null: none). */
  onPick?(lines: { start: number; end: number } | null): void;
  /** Esc with nothing of the editor's to close. */
  onEscape?(): void;
}

/**
 * A file's text in Monaco, which loads on first use (its own chunk and workers). The theme follows the app's tokens
 * and the light or dark mode; ⌘S calls `onSave`.
 */
export const FileEditor = forwardRef<FileEditorHandle | null, FileEditorProps>(function FileEditor({ path, editKey, seq, value, extension, wrap, autoFocus = true, onDirty, onSave, keep, marks, search, onPick, onEscape }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<FileEditorHandle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const callbacks = useRef({ onDirty, onSave, keep, onPick, onEscape });
  callbacks.current = { onDirty, onSave, keep, onPick, onEscape };
  useImperativeHandle(ref, () => handle as FileEditorHandle, [handle]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let disposed = false;
    let created: FileEditorHandle | null = null;
    void import('./monacoEditor.ts')
      .then(({ createFileEditor }) => createFileEditor(el, { key: editKey, seq, value, path, extension, wrap, onDirty: (d) => callbacks.current.onDirty(d), onSave: () => callbacks.current.onSave(), onPick: (lines) => callbacks.current.onPick?.(lines), onEscape: () => callbacks.current.onEscape?.() }))
      .then(
        (editor) => {
          if (disposed) return editor.dispose(callbacks.current.keep());
          created = editor;
          setHandle(editor);
          if (autoFocus) editor.focus();
        },
        (error: unknown) => !disposed && setFailed(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      disposed = true;
      created?.dispose(callbacks.current.keep());
    };
    // The editor is made once per file; a new text from disk comes through a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => handle?.setWrap(wrap), [handle, wrap]);
  useEffect(() => handle?.setMarks(marks), [handle, marks]);
  useEffect(() => handle?.setSearch(search?.matches ?? [], search?.current ?? -1), [handle, search]);

  // The theme follows the app's: its tokens, its syntax colours and the mode.
  const active = useThemes((s) => s.active);
  const syntaxKey = useThemes((s) => s.syntaxKey);
  const dark = useDark();
  const colorScheme = usePreferences((s) => s.prefs.colorScheme);
  useEffect(() => {
    if (!handle || !hostRef.current) return;
    const el = hostRef.current;
    void import('./monacoEditor.ts').then(({ applyTheme }) => applyTheme(el));
  }, [handle, active, syntaxKey, dark, colorScheme]);

  return (
    <div className="relative flex min-h-0 flex-1 bg-code" data-file-editor={handle ? 'ready' : failed ? 'failed' : 'loading'}>
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" data-file-editor-host="" />
      {!handle && !failed && (
        <p role="status" className="absolute top-0 left-0 p-5 text-ui text-muted">
          Loading the editor…
        </p>
      )}
      {failed && (
        <p role="alert" className="absolute top-0 left-0 p-5 text-ui text-error">
          The editor didn't load: {failed}
        </p>
      )}
    </div>
  );
});
