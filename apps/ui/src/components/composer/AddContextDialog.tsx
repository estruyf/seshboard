import { modKey } from '../../lib/shortcuts.ts';
import { FileText } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { joinPath } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComposerTargets, type ComposerTarget } from '../../state/composerTargets.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { Button } from '../ui/Button.tsx';
import { CheckMark } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Kbd } from '../ui/Kbd.tsx';

/** The Add context picker for the message box it was opened from (⌘⇧A, the paperclip, or the palette). */
export function AddContextDialogHost() {
  const target = useComposerTargets((s) => s.picker);
  if (!target?.cwd) return null;
  return <AddContextDialog key={target.key} target={{ key: target.key, cwd: target.cwd }} onClose={() => useComposerTargets.getState().closePicker()} />;
}

/**
 * Picks several files of the session's folder at once and adds them to the message as chips. Typing filters (like
 * the `@` list), Space picks the highlighted file, Enter adds what is picked (or the highlighted file).
 */
function AddContextDialog({ target, onClose }: { target: ComposerTarget & { cwd: string }; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!client) return;
    let current = true;
    client.call('files.search', { cwd: target.cwd, query, limit: 50 }).then(
      (result) => {
        if (!current) return;
        setFiles(result.files);
        setActive(0);
        setError(null);
      },
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [client, target.cwd, query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (file: string) => setPicked((list) => (list.includes(file) ? list.filter((f) => f !== file) : [...list, file]));
  const add = (chosen = picked.length ? picked : files.slice(active, active + 1)) => {
    if (chosen.length === 0) return;
    useDrafts.getState().addContext(
      target.key,
      chosen.map((file) => ({ kind: 'file', path: joinPath(target.cwd, file), directory: false })),
    );
    onClose();
    useDrafts.getState().requestFocus(target.key);
  };

  const count = picked.length;
  return (
    <Dialog
      placement="top"
      width="palette"
      flush
      title="Add context"
      subtitle="Files Claude reads with your message. They show as chips above it until you send."
      onClose={onClose}
      onSubmit={() => add()}
      data-add-context-dialog
      footerStart={
        <span className="flex items-center gap-1.5 text-meta text-muted">
          <Kbd keys="space" /> to pick several <Kbd keys="enter" /> to add
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="⌘↵" onClick={() => add()} disabled={count === 0 && files.length === 0} data-add-context-confirm>
            {count > 1 ? `Add ${count} files` : 'Add file'}
          </Button>
        </>
      }
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(files.length - 1, i + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
          else if (e.key === ' ' && files[active]) (e.preventDefault(), toggle(files[active]!));
          else if (e.key === 'Enter' && !modKey(e) && !e.nativeEvent.isComposing) (e.preventDefault(), add());
        }}
        placeholder="Search files"
        aria-label="Search files in the session's folder"
        aria-controls={`${id}-list`}
        aria-activedescendant={files[active] ? `${id}-file-${active}` : undefined}
        spellCheck={false}
        className="h-10 shrink-0 border-b border-edge bg-transparent px-5 text-body text-text outline-none placeholder:text-faint"
        data-add-context-search
      />
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? (
          <p role="alert" className="px-5 py-3 text-ui text-error">
            {error}
          </p>
        ) : (
          files.length === 0 && <p className="px-5 py-3 text-ui text-muted">{query ? 'No file matches.' : 'No files found in this folder.'}</p>
        )}
        {files.map((file, index) => {
          const slash = file.lastIndexOf('/');
          return (
            <div
              key={file}
              id={`${id}-file-${index}`}
              role="option"
              aria-selected={picked.includes(file)}
              data-active={index === active}
              data-add-context-file={file}
              onMouseMove={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(file)}
              className={`flex cursor-default items-center gap-2.5 px-5 py-1.5 ${index === active ? 'bg-accent/15' : ''}`}
            >
              <CheckMark checked={picked.includes(file)} />
              <FileText size={13} className="shrink-0 text-muted" aria-hidden />
              <span className="shrink-0 font-mono text-ui text-text">{file.slice(slash + 1)}</span>
              {slash > 0 && <span className="min-w-0 truncate font-mono text-meta text-muted">{file.slice(0, slash)}</span>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
